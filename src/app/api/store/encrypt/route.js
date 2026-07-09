// app/api/store/encrypt/route.js
//
// Encrypts a seller's gated content (text/link and/or one or more files) server-side before it's
// pinned to IPFS. The AES-256-GCM key is derived deterministically per postId from a server-only
// secret — nothing is stored in a database, and nothing but ciphertext ever leaves this process.

import { NextResponse } from 'next/server'
import { uploadFileToIPFS } from '@/lib/ipfsUpload'
import { encryptContent, isConfigured } from '@/lib/storeCrypto'
import { moderateContent } from '@/lib/moderation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_FILE_SIZE_MB = 10
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
const MAX_FILES = 5
const MAX_LINKS = 5
const MAX_NAME_LENGTH = 120
const MAX_DESCRIPTION_LENGTH = 2000
const MAX_LINK_NAME_LENGTH = 80

function isHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function parseLinks(raw) {
  if (!raw) return []
  let parsed
  try {
    parsed = JSON.parse(String(raw))
  } catch {
    throw new Error('Links must be valid JSON')
  }
  if (!Array.isArray(parsed)) throw new Error('Links must be an array')
  if (parsed.length > MAX_LINKS) throw new Error(`Too many links — max ${MAX_LINKS} per listing`)

  return parsed.map((link) => {
    const name = String(link?.name || '').trim()
    const url = String(link?.url || '').trim()
    if (!name || name.length > MAX_LINK_NAME_LENGTH) throw new Error('Each link needs a name (max 80 characters)')
    if (!isHttpUrl(url)) throw new Error(`"${name}" needs a valid http(s) URL`)
    return { name, url }
  })
}

export async function POST(request) {
  try {
    if (!isConfigured()) {
      return NextResponse.json({ error: 'Server is not configured for gated content encryption' }, { status: 500 })
    }

    const data = await request.formData()
    const postId = data.get('postId')
    const networkId = data.get('networkId')
    const name = String(data.get('name') || '').trim()
    const description = String(data.get('description') || '').trim()
    const files = data.getAll('files').filter((f) => f instanceof File && f.size > 0)

    if (!postId || !networkId) {
      return NextResponse.json({ error: 'postId and networkId are required' }, { status: 400 })
    }
    if (name.length > MAX_NAME_LENGTH) {
      return NextResponse.json({ error: `Name is too long (max ${MAX_NAME_LENGTH} characters)` }, { status: 400 })
    }
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      return NextResponse.json({ error: `Description is too long (max ${MAX_DESCRIPTION_LENGTH} characters)` }, { status: 400 })
    }

    let links
    try {
      links = parseLinks(data.get('links'))
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }

    if (!name && !description && links.length === 0 && files.length === 0) {
      return NextResponse.json({ error: 'Provide a name, description, at least one link, or at least one file' }, { status: 400 })
    }
    if (files.length > MAX_FILES) {
      return NextResponse.json({ error: `Too many files — max ${MAX_FILES} per listing` }, { status: 413 })
    }
    const oversized = files.find((f) => f.size > MAX_FILE_SIZE_BYTES)
    if (oversized) {
      return NextResponse.json(
        { error: `"${oversized.name}" is too large (max ${MAX_FILE_SIZE_MB}MB per file) — for heavy files, sell a link to the content instead` },
        { status: 413 },
      )
    }

    // The moderation API has no video input type, and video is heavy anyway — sellers with
    // videos should link to where it's hosted instead of uploading it here.
    const video = files.find((f) => (f.type || '').startsWith('video/'))
    if (video) {
      return NextResponse.json(
        { error: `Video files aren't supported here — paste a link to where "${video.name}" is hosted instead of uploading it` },
        { status: 400 },
      )
    }

    const fileItems = await Promise.all(
      files.map(async (file) => ({
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        dataBase64: Buffer.from(await file.arrayBuffer()).toString('base64'),
      })),
    )

    // Check the actual sellable content (name, description, links, images) for anything harmful
    // before it's ever encrypted or pinned. Shimmed into the same shape moderateContent() expects
    // for regular posts (lib/postContent.js), since gated-content listings use a different
    // element-type naming (name/description/links/files vs text/media).
    const moderationText = [name, description, ...links.map((l) => `${l.name}: ${l.url}`)].filter(Boolean).join('\n')
    const moderation = await moderateContent({
      elements: [
        { type: 'text', data: { text: moderationText } },
        {
          type: 'media',
          data: {
            items: fileItems
              .filter((f) => f.mimeType.startsWith('image/'))
              .map((f) => ({ type: 'image', url: `data:${f.mimeType};base64,${f.dataBase64}` })),
          },
        },
      ],
    })
    if (moderation?.flagged) {
      return NextResponse.json(
        {
          error: `Flagged as harmful${moderation.categories.length ? ` (${moderation.categories.join(', ')})` : ''}. Please revise.`,
        },
        { status: 400 },
      )
    }

    // Structured envelope, mirroring the post-content elements shape: a typed block per concern
    // (name, description, links, files) so each can be read/rendered independently.
    const envelope = {
      version: 1,
      elements: [
        { type: 'name', data: { text: name } },
        { type: 'description', data: { text: description } },
        { type: 'links', data: { items: links } },
        { type: 'files', data: { items: fileItems } },
      ],
    }

    const plaintext = Buffer.from(JSON.stringify(envelope), 'utf8')
    const encrypted = await encryptContent(Number(networkId), postId, plaintext)
    const encryptedFile = new File([encrypted], `${postId}.enc`, { type: 'application/octet-stream' })

    const rawCID = await uploadFileToIPFS(encryptedFile)

    return NextResponse.json({ cid: `ipfs://${rawCID}` }, { status: 200 })
  } catch (e) {
    console.error('Gated content encryption error:', e)
    return NextResponse.json({ error: 'Internal Server Error during encryption' }, { status: 500 })
  }
}

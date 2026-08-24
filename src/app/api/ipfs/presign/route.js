// app/api/ipfs/presign/route.js
//
// Hands the browser a URL it can upload straight to, bypassing the 4.5 MB Vercel function
// payload limit that caps /api/ipfs/file. Video is the reason this exists — a phone clip
// clears that limit within a couple of seconds of footage.
//
// Filebase is primary (it is already the primary pinner for small uploads, so CIDs come from
// the same place either way) with Pinata as the fallback, mirroring the provider order
// /api/ipfs/file already uses. Filebase speaks S3 rather than a bespoke signed-upload API,
// which means the CID is not known at signing time — the client uploads to a key we choose,
// then resolves that key to a CID via /api/ipfs/cid.

import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { PinataSDK } from 'pinata'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const pinata = new PinataSDK({ pinataJwt: process.env.PINATA_JWT })

export const dynamic = 'force-dynamic'

/* This route is unauthenticated, so the ceiling is enforced here rather than trusted from the
   client. Kept in step with MAX_VIDEO_SIZE_MB in NewPost.jsx, plus headroom for the container
   overhead a re-muxed upload can carry. */
const MAX_UPLOAD_BYTES = 105 * 1024 * 1024

const SIGNED_URL_TTL_SECONDS = 600

const filebaseConfigured = () =>
  Boolean(process.env.FILEBASE_S3_KEY && process.env.FILEBASE_S3_SECRET && process.env.FILEBASE_S3_BUCKET)

/* Filebase exposes an S3-compatible endpoint; path-style addressing keeps the bucket out of the
   hostname so a bucket name with dots can't break TLS validation. */
const s3 = () =>
  new S3Client({
    region: 'auto',
    endpoint: 'https://s3.filebase.io',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.FILEBASE_S3_KEY,
      secretAccessKey: process.env.FILEBASE_S3_SECRET,
    },
  })

/* Only the extension survives from the client-supplied name — the key itself is a UUID, so a
   crafted filename can't traverse the bucket or collide with an existing object. */
function safeKey(name) {
  const extension = /\.([A-Za-z0-9]{1,8})$/.exec(name || '')?.[1]?.toLowerCase()
  return `uploads/${randomUUID()}${extension ? `.${extension}` : ''}`
}

async function filebasePresign({ name, mimeType, size }) {
  const key = safeKey(name)

  const command = new PutObjectCommand({
    Bucket: process.env.FILEBASE_S3_BUCKET,
    Key: key,
    ContentType: mimeType || 'application/octet-stream',
    ContentLength: size,
  })

  /* Signing content-length as well as content-type is what makes MAX_UPLOAD_BYTES binding:
     the upload is rejected at the edge unless the body is exactly the size that was declared
     here, so an oversized file can't ride in on a URL signed for a small one. */
  const url = await getSignedUrl(s3(), command, {
    expiresIn: SIGNED_URL_TTL_SECONDS,
    signableHeaders: new Set(['content-length', 'content-type']),
  })

  return { provider: 'filebase', url, key, method: 'PUT' }
}

async function pinataPresign({ name, mimeType, size }) {
  const url = await pinata.upload.public.createSignedURL({
    expires: SIGNED_URL_TTL_SECONDS,
    name: name ?? 'upload',
    maxFileSize: size,
    ...(mimeType ? { mimeTypes: [mimeType] } : {}),
  })

  return { provider: 'pinata', url, method: 'POST' }
}

export async function POST(request) {
  try {
    const { name, mimeType, size } = await request.json()

    const declaredSize = Number(size)
    if (!Number.isInteger(declaredSize) || declaredSize <= 0) {
      return NextResponse.json({ error: 'A positive integer size is required' }, { status: 400 })
    }
    if (declaredSize > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `File exceeds the ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB upload limit` },
        { status: 413 }
      )
    }

    if (filebaseConfigured()) {
      try {
        return NextResponse.json(await filebasePresign({ name, mimeType, size: declaredSize }))
      } catch (e) {
        console.warn('[presign] Filebase signing failed, falling back to Pinata:', e.message)
      }
    }

    return NextResponse.json(await pinataPresign({ name, mimeType, size: declaredSize }))
  } catch (e) {
    console.error('Presign error:', e)
    const overLimit = typeof e?.message === 'string' && e.message.includes('plan limits')
    return NextResponse.json(
      { error: overLimit ? 'Storage provider is over its plan limits' : 'Could not create signed URL' },
      { status: 502 }
    )
  }
}

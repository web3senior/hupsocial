// app/api/ipfs/file/route.js

import { NextResponse } from 'next/server'
import { PinataSDK } from 'pinata'
import sharp from 'sharp'

const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT,
})

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function uploadToFilebase(file) {
  const form = new FormData()
  form.append('file', file, file.name)

  const res = await fetch('https://rpc.filebase.io/api/v0/add', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.FILEBASE_IPFS_RPC_TOKEN}`,
    },
    body: form,
  })

  if (!res.ok) throw new Error(`Filebase RPC ${res.status}: ${await res.text()}`)

  const { Hash } = await res.json()
  console.log('[filebase] uploaded, CID:', Hash)
  return Hash
}

async function uploadToPinata(file) {
  const result = await pinata.upload.public.file(file, {
    pinataMetadata: { name: file.name },
  })
  console.log('[pinata] uploaded, CID:', result.cid)
  return result.cid
}

export async function POST(request) {
  try {
    const data = await request.formData()
    const file = data.get('file')

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    console.log(`Uploading file: ${file.name}`)

    let rawCID
    try {
      rawCID = await uploadToFilebase(file)
    } catch (e) {
      console.warn('[filebase] upload failed, falling back to Pinata:', e.message)
      rawCID = await uploadToPinata(file)
    }

    const cid = `ipfs://${rawCID}`
    const url = `${process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL}${rawCID}`
    console.log('Upload complete. CID:', cid)
    return NextResponse.json({ url, cid }, { status: 200 })
  } catch (e) {
    console.error('File upload error:', e)
    return NextResponse.json({ error: 'Internal Server Error during upload' }, { status: 500 })
  }
}

function intParam(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const cid = searchParams.get('cid')

  const width = intParam(searchParams.get('w'), null, 1, 4096)
  const quality = intParam(searchParams.get('q'), 80, 1, 100)

  if (!cid) {
    return NextResponse.json({ error: 'CID is required' }, { status: 400 })
  }

  const gatewayUrl = `${process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL}${cid}`

  try {
    const upstream = await fetch(gatewayUrl)

    if (!upstream.ok) {
      throw new Error(`IPFS Gateway Error: ${upstream.status}`)
    }

    const contentType = upstream.headers.get('content-type') || ''

    /* Only images go through sharp — video/audio stream straight from the gateway */
    if (!contentType.startsWith('image/')) {
      return NextResponse.redirect(gatewayUrl, 302)
    }

    /* HEIC/HEIF decoding needs a libheif build with HEVC support, which prebuilt
       sharp binaries omit for licensing reasons — stream the original instead */
    if (/^image\/hei[cf](-sequence)?$/i.test(contentType)) {
      return NextResponse.redirect(gatewayUrl, 302)
    }

    const arrayBuffer = await upstream.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const metadata = await sharp(buffer, { animated: true }).metadata()
    const isAnimated = (metadata.pages ?? 1) > 1

    let pipeline = sharp(buffer, { animated: true, autoOrient: true })

    if (width) {
      pipeline = pipeline.resize({
        width,
        withoutEnlargement: true,
      })
    }

    const optimizedBuffer = await pipeline
      .webp({
        quality,
        ...(isAnimated
          ? {
              loop: metadata.loop ?? 0,
              ...(metadata.delay ? { delay: metadata.delay } : {}),
            }
          : {}),
      })
      .toBuffer()

    return new Response(optimizedBuffer, {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    console.error('IPFS_API_ROUTE_ERROR:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}

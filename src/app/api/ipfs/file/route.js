// app/api/ipfs/file/route.js

import { NextResponse } from 'next/server'
import { PinataSDK } from 'pinata'
import sharp from 'sharp'

const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT,
})

/* Detect HEIC/HEIF by container magic ("ftyp" box + brand) — browsers frequently
   report an empty or generic mime for .heic files, so headers can't be trusted */
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'])

function isHeic(buffer) {
  if (buffer.length < 12 || buffer.toString('latin1', 4, 8) !== 'ftyp') return false
  const brand = buffer.toString('latin1', 8, 12)
  /* mif1/msf1 are generic HEIF brands some AVIF encoders reuse as the major brand —
     sharp decodes AVIF natively, so leave those alone */
  if ((brand === 'mif1' || brand === 'msf1') && buffer.toString('latin1', 0, Math.min(buffer.length, 64)).includes('avif')) return false
  return HEIC_BRANDS.has(brand)
}

/* Prebuilt sharp binaries ship libheif without HEVC for licensing reasons, and raw
   HEIC only renders in Safari — decode with the wasm-based heic-convert instead.
   Dynamically imported so non-HEIC requests never pay its startup cost. */
async function heicToJpeg(buffer) {
  const { default: convert } = await import('heic-convert')
  return Buffer.from(await convert({ buffer, format: 'JPEG', quality: 0.9 }))
}

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
    let file = data.get('file')

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    console.log(`Uploading file: ${file.name}`)

    /* iPhone photos arrive as HEIC, which only Safari can render — transcode to
       JPEG before pinning so the CID is viewable on every device and gateway */
    const head = Buffer.from(await file.slice(0, 64).arrayBuffer())
    if (isHeic(head)) {
      const jpeg = await heicToJpeg(Buffer.from(await file.arrayBuffer()))
      const jpegName = `${(file.name || 'upload').replace(/\.(heic|heif)$/i, '')}.jpg`
      file = new File([jpeg], jpegName, { type: 'image/jpeg' })
      console.log(`[heic] transcoded to JPEG before pinning: ${jpegName}`)
    }

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

// A gateway that never answers used to hold the request open until the socket died ~30s
// later. Browsers only open ~6 connections per origin, so two such stalls were enough to
// starve every other image on the page — cards spun forever instead of falling back to a
// placeholder. Failing fast frees the connection and lets the rest of the grid render.
const GATEWAY_TIMEOUT_MS = 8000

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
  const stillOnly = searchParams.get('still') === '1'

  if (!cid) {
    return NextResponse.json({ error: 'CID is required' }, { status: 400 })
  }

  const gatewayUrl = `${process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL}${cid}`

  try {
    const upstream = await fetch(gatewayUrl, { signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS) })

    if (!upstream.ok) {
      throw new Error(`IPFS Gateway Error: ${upstream.status}`)
    }

    const contentType = upstream.headers.get('content-type') || ''

    /* Only images go through sharp — video/audio stream straight from the gateway */
    if (!contentType.startsWith('image/')) {
      return NextResponse.redirect(gatewayUrl, 302)
    }

    const arrayBuffer = await upstream.arrayBuffer()
    let buffer = Buffer.from(arrayBuffer)

    /* CIDs pinned before uploads transcoded HEIC are still raw HEIC on IPFS —
       decode them here so they render outside Safari like everything else */
    if (isHeic(buffer)) {
      buffer = await heicToJpeg(buffer)
    }

    /* still=1 decodes/encodes only the first frame — skips the expensive per-frame
       resize+encode animated GIFs/WEBPs otherwise need, for thumbnail contexts that
       don't render motion anyway (grid cards, compact previews) */
    const metadata = await sharp(buffer, { animated: !stillOnly }).metadata()
    const isAnimated = !stillOnly && (metadata.pages ?? 1) > 1

    let pipeline = sharp(buffer, { animated: !stillOnly, autoOrient: true })

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
        /* The output is a pure function of cid + params, so it can sit in the shared cache
           forever. Without s-maxage only browsers cached it, and every social crawler that
           scraped a link paid the full gateway fetch + sharp re-encode again. */
        'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable',
        'CDN-Cache-Control': 'public, s-maxage=31536000',
      },
    })
  } catch (error) {
    // TimeoutError means the gateway never answered; report it as a gateway timeout so the
    // difference between "we broke" and "the gateway is unreachable" is visible in the logs.
    const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError'
    if (!timedOut) console.error('IPFS_API_ROUTE_ERROR:', error)
    else console.warn(`IPFS_GATEWAY_TIMEOUT after ${GATEWAY_TIMEOUT_MS}ms:`, cid)
    return NextResponse.json({ error: timedOut ? 'IPFS gateway timed out' : error.message || 'Internal Server Error' }, { status: timedOut ? 504 : 500 })
  }
}

// app/api/ipfs/file/route.js

import { NextResponse } from 'next/server'
import { PinataSDK } from 'pinata'
import sharp from 'sharp'
import { bothProvidersFailed, shortUploadError } from '@/lib/uploadErrors'
import { FAILURE_TTL_MS, coalesceMedia, readMedia, writeMediaBody, writeMediaFailure, writeMediaRedirect } from '@/lib/mediaCache'
import { readDurableFailure, recordDurableFailure } from '@/lib/mediaFailureStore'

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
    } catch (filebaseError) {
      console.warn('[filebase] upload failed, falling back to Pinata:', filebaseError.message)
      try {
        rawCID = await uploadToPinata(file)
      } catch (pinataError) {
        console.error('[pinata] fallback upload failed:', pinataError.message)
        return NextResponse.json({ error: bothProvidersFailed(filebaseError, pinataError) }, { status: 502 })
      }
    }

    const cid = `ipfs://${rawCID}`
    const url = `${process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL}${rawCID}`
    console.log('Upload complete. CID:', cid)
    return NextResponse.json({ url, cid }, { status: 200 })
  } catch (e) {
    console.error('File upload error:', e)
    return NextResponse.json({ error: shortUploadError(e, 'Upload failed on the server') }, { status: 500 })
  }
}

// A gateway that never answers used to hold the request open until the socket died ~30s
// later. Browsers only open ~6 connections per origin, so two such stalls were enough to
// starve every other image on the page — cards spun forever instead of falling back to a
// placeholder. Failing fast frees the connection and lets the rest of the grid render.
const GATEWAY_TIMEOUT_MS = 8000

/* The bytes are a pure function of cid + params, so they can sit in the shared cache
   forever. Without s-maxage only browsers cached it, and every social crawler that scraped
   a link paid the full gateway fetch + sharp re-encode again. */
const SUCCESS_CACHE_CONTROL = 'public, max-age=31536000, s-maxage=31536000, immutable'

/* Failures are cacheable too, and not caching them is what actually hurt. Unpinned content
   is ordinary on IPFS, so a dead CID cost its full GATEWAY_TIMEOUT_MS on every render of
   every page it appeared on, forever — a ranking table carrying four of them spent 32s of
   the browser's six connections doing nothing, and every other thumbnail queued behind
   that. Held only for the negative-cache window, so a CID pinned this morning still shows
   up without a deploy. */
const FAILURE_CACHE_CONTROL = `public, max-age=${Math.floor(FAILURE_TTL_MS / 1000)}, s-maxage=${Math.floor(FAILURE_TTL_MS / 1000)}`

function intParam(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

/**
 * Turns a cache entry into its HTTP response. The same three shapes come back whether the
 * entry was just produced or read out of memory, so a hit and a miss can never disagree
 * about what a CID resolves to.
 * @param {{kind: 'body'|'redirect'|'error'}} entry A mediaCache entry.
 * @returns {Response} The response to serve.
 */
function respond(entry) {
  if (entry.kind === 'redirect') {
    return new NextResponse(null, { status: 302, headers: { Location: entry.location, 'Cache-Control': SUCCESS_CACHE_CONTROL } })
  }

  if (entry.kind === 'error') {
    return NextResponse.json({ error: entry.message }, { status: entry.status, headers: { 'Cache-Control': FAILURE_CACHE_CONTROL } })
  }

  return new Response(entry.body, {
    headers: {
      'Content-Type': entry.contentType,
      'Cache-Control': SUCCESS_CACHE_CONTROL,
      'CDN-Cache-Control': 'public, s-maxage=31536000',
    },
  })
}

/**
 * The cache-miss path: fetch from the gateway, transcode, optimize, and record the outcome
 * — success or failure — so the next caller for this key repeats none of it.
 * @param {Object} params
 * @param {string} params.cacheKey Identity of the entry being produced.
 * @param {string} params.cid Content address to resolve.
 * @param {number|null} params.width Resize target, or null to keep the original width.
 * @param {number} params.quality Encoder quality, 1-100.
 * @param {'webp'|'jpeg'} params.format Output encoding.
 * @param {boolean} params.stillOnly Decode the first frame only.
 * @returns {Promise<{kind: 'body'|'redirect'|'error'}>} The entry, already written to cache.
 */
async function resolveMedia({ cacheKey, cid, width, quality, format, stillOnly }) {
  const gatewayUrl = `${process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL}${cid}`

  try {
    const upstream = await fetch(gatewayUrl, { signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS) })

    if (!upstream.ok) {
      throw new Error(`IPFS Gateway Error: ${upstream.status}`)
    }

    const contentType = upstream.headers.get('content-type') || ''

    /* Only images go through sharp — video/audio stream straight from the gateway */
    if (!contentType.startsWith('image/')) {
      writeMediaRedirect(cacheKey, gatewayUrl)
      return { kind: 'redirect', location: gatewayUrl }
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

    const optimizedBuffer =
      format === 'jpeg'
        ? await pipeline
            /* JPEG has no alpha channel — without a flatten, transparent PNGs
               decode onto black and the card renders as a dark slab */
            .flatten({ background: '#ffffff' })
            .jpeg({ quality, progressive: true, mozjpeg: true })
            .toBuffer()
        : await pipeline
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

    const outputType = format === 'jpeg' ? 'image/jpeg' : 'image/webp'
    writeMediaBody(cacheKey, optimizedBuffer, outputType)
    return { kind: 'body', body: optimizedBuffer, contentType: outputType }
  } catch (error) {
    // TimeoutError means the gateway never answered; report it as a gateway timeout so the
    // difference between "we broke" and "the gateway is unreachable" is visible in the logs.
    const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError'
    if (!timedOut) console.error('IPFS_API_ROUTE_ERROR:', error)
    else console.warn(`IPFS_GATEWAY_TIMEOUT after ${GATEWAY_TIMEOUT_MS}ms:`, cid)

    const status = timedOut ? 504 : 500
    const message = timedOut ? 'IPFS gateway timed out' : error.message || 'Internal Server Error'
    writeMediaFailure(cacheKey, status, message)

    /* Timeouts also go in the database, so the next instance to be asked doesn't spend the
       timeout finding out for itself — the in-process record dies with this process, and on a
       serverless deployment that is often one request. Only timeouts: a 500 is our own decode
       failing, which is the class a deploy fixes, and a deploy doesn't clear a table. */
    if (timedOut) await recordDurableFailure({ cacheKey, cid, status, message })

    return { kind: 'error', status, message }
  }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const cid = searchParams.get('cid')

  const width = intParam(searchParams.get('w'), null, 1, 4096)
  const quality = intParam(searchParams.get('q'), 80, 1, 100)

  /* Social crawlers are inconsistent about WebP — X in particular will drop a card rather
     than render one — so link previews ask for fmt=jpeg. JPEG has no animation, so it
     forces the still path regardless of what the caller passed. */
  const format = searchParams.get('fmt') === 'jpeg' ? 'jpeg' : 'webp'
  const stillOnly = searchParams.get('still') === '1' || format === 'jpeg'

  if (!cid) {
    return NextResponse.json({ error: 'CID is required' }, { status: 400 })
  }

  /* Every input the bytes depend on and nothing else, so two surfaces asking for the same
     thumbnail at the same width share one gateway fetch and one sharp encode */
  const cacheKey = `${cid}|${width ?? ''}|${quality}|${stillOnly ? 1 : 0}|${format}`

  const cached = readMedia(cacheKey)
  if (cached) return respond(cached)

  /* Coalesced, so a page of cards pointing at one CID spends a single database lookup and,
     if it is not a known-dead one, a single gateway fetch behind it. */
  return respond(
    await coalesceMedia(cacheKey, async () => {
      /* An address this process has never seen may still be one another instance has already
         proved unresolvable. Reading that costs a primary-key lookup; not reading it costs
         GATEWAY_TIMEOUT_MS, on every cold start, for as long as the CID stays unpinned. */
      const known = await readDurableFailure(cacheKey)
      if (known) {
        writeMediaFailure(cacheKey, known.status, known.message)
        return { kind: 'error', ...known }
      }

      return resolveMedia({ cacheKey, cid, width, quality, format, stillOnly })
    }),
  )
}

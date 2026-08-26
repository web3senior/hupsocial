// app/api/ipfs/file/route.js

import { NextResponse } from 'next/server'
import { PinataSDK } from 'pinata'
import sharp from 'sharp'
import { webpAnimationOptions } from '@/lib/webpAnimation'
import { bothProvidersFailed, shortUploadError } from '@/lib/uploadErrors'
import { addToFilebase } from '@/lib/filebase'
import { gatewayList } from '@/lib/ipfsGateways'
import { FAILURE_TTL_MS, TRANSIENT_FAILURE_TTL_MS, coalesceMedia, readMedia, writeMediaBody, writeMediaFailure, writeMediaRedirect } from '@/lib/mediaCache'
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
/* The GET walks a chain of gateways and then runs an encode; without this, the platform's
   default function ceiling (10–15s without Fluid Compute) could kill a request in the middle
   of the fallback that was about to succeed. Same figure the other long routes here use. */
export const maxDuration = 60

async function uploadToFilebase(file) {
  /* Rebuilt per attempt: a File/Blob is consumed by the request that sends it */
  return addToFilebase(() => {
    const form = new FormData()
    form.append('file', file, file.name)
    return form
  })
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
//
// The budget is split in two, because it guards two different waits. Waiting for HEADERS is
// waiting to learn whether the gateway has the content at all — an unpinned CID hangs here
// forever. Waiting for the BODY is downloading a file the gateway has already found, and a
// 3.6MB camera original takes several seconds on a good day. One budget for both meant a
// slow transfer read as "unresolvable" and got the CID negatively cached for the next half
// hour on every instance — which is what "some images don't load" turned out to be.
const PRIMARY_HEADERS_TIMEOUT_MS = 8000
/* Fallbacks get less patience: by the time one is asked, the caller has already waited once */
const FALLBACK_HEADERS_TIMEOUT_MS = 5000
/* The body phase is timed on PROGRESS, not on total elapsed time, because a flat ceiling
   cannot tell the two body failures apart. A big file arriving slowly and a file that stops
   arriving both hit 15s; only one of them says anything about the CID. Partially-pinned
   content is the case that matters: a UP profile picture whose first UnixFS leaf survives and
   whose other eight blocks are gone streams ~232KB of its declared 1.98MB from every gateway
   and then goes silent forever. So the clock restarts on every chunk — a slow transfer keeps
   buying time as long as bytes keep coming, and a stall is caught in a fraction of the old
   ceiling and reported for what it is. */
const BODY_STALL_TIMEOUT_MS = 6000
/* Ceiling for the whole chain — the primary's patience, one round of fallbacks, and however
   long a slow body is allowed to take — so the encode still fits inside maxDuration after it.
   An unpinned CID costs the first two: 13s, once, then the negative caches take over. */
const TOTAL_FETCH_BUDGET_MS = 24000
/* Less than this left and it is not worth opening a socket */
const MIN_ATTEMPT_MS = 1500

/* The gateway chain moved to lib/ipfsGateways so the article body reader walks the same hosts
   in the same order — two copies would drift the moment one of them gained a fallback. */

/* The bytes are a pure function of cid + params, so they can sit in the shared cache
   forever. Without s-maxage only browsers cached it, and every social crawler that scraped
   a link paid the full gateway fetch + sharp re-encode again. */
const SUCCESS_CACHE_CONTROL = 'public, max-age=31536000, s-maxage=31536000, immutable'

/**
 * Failures are cacheable too, and not caching them is what actually hurt. Unpinned content
 * is ordinary on IPFS, so a dead CID cost its full fetch budget on every render of every
 * page it appeared on, forever — a ranking table carrying four of them spent 32s of the
 * browser's six connections doing nothing, and every other thumbnail queued behind that.
 * Held only for the entry's own negative-cache window — the full one for a CID nobody has,
 * a short one for a gateway that merely had a bad minute — so a CID pinned this morning
 * still shows up without a deploy.
 * @param {number} ttlMs How long the entry is believed.
 * @returns {string} The Cache-Control header value.
 */
function failureCacheControl(ttlMs) {
  const seconds = Math.floor(ttlMs / 1000)
  return `public, max-age=${seconds}, s-maxage=${seconds}`
}

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
    return NextResponse.json({ error: entry.message }, { status: entry.status, headers: { 'Cache-Control': failureCacheControl(entry.ttlMs ?? FAILURE_TTL_MS) } })
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
 * Drains a response body under a stall clock rather than a total one. The timer is rearmed on
 * every chunk, so a transfer keeps its budget for as long as it is making progress and loses it
 * the moment it stops — which is the difference between a big file on a slow link and content
 * whose remaining blocks nobody has.
 * @param {Response} upstream The gateway response, already known to be ok.
 * @param {Object} budget
 * @param {number} budget.deadline Absolute time (ms epoch) the whole chain must be done by.
 * @param {() => void} budget.abort Aborts the underlying request.
 * @returns {Promise<Buffer>} The complete body.
 * @throws {Error} `stalled: true` and the byte count so far when the stream goes quiet.
 */
async function drainBody(upstream, { deadline, abort }) {
  const reader = upstream.body.getReader()
  const chunks = []
  let received = 0
  let stalled = false

  const arm = () => {
    const wait = Math.min(BODY_STALL_TIMEOUT_MS, deadline - Date.now())
    return setTimeout(() => {
      /* Only a full quiet window is evidence about the content. When the clamp above cut the
         wait short, what expired was the chain's total budget mid-transfer, and that says
         nothing about the CID — the bytes were still coming. */
      stalled = wait >= BODY_STALL_TIMEOUT_MS
      abort()
    }, Math.max(1, wait))
  }

  let timer = arm()

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      clearTimeout(timer)
      chunks.push(value)
      received += value.length
      timer = arm()
    }
  } catch (error) {
    if (!stalled) throw error

    const timeout = new Error(`stalled after ${received} bytes`)
    timeout.name = 'TimeoutError'
    timeout.stalled = true
    throw timeout
  } finally {
    clearTimeout(timer)
  }

  return Buffer.concat(chunks)
}

/**
 * Fetches one gateway under the two-phase budget. Rejects with an error carrying `phase`
 * ('headers' | 'body'), so the caller can tell "never found it" from "found it, lost it",
 * plus `stalled` on the body failure that means the content stopped arriving mid-stream.
 * @param {string} url Full gateway URL for the CID.
 * @param {Object} budget
 * @param {number} budget.headersMs How long to wait for the gateway to answer at all.
 * @param {number} budget.deadline Absolute time (ms epoch) the whole chain must be done by.
 * @param {AbortSignal} [budget.signal] Cancels the attempt from outside — a racing gateway won.
 * @returns {Promise<{url: string, contentType: string, buffer: Buffer|null}>} The bytes — or a
 * null buffer for non-image content, which the caller redirects to rather than proxies.
 */
async function fetchGateway(url, { headersMs, deadline, signal }) {
  const controller = new AbortController()
  const arm = (ms) => setTimeout(() => controller.abort(), Math.max(1, Math.min(ms, deadline - Date.now())))
  const cancel = () => controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  let phase = 'headers'
  const timer = arm(headersMs)

  try {
    const upstream = await fetch(url, { signal: controller.signal })

    if (!upstream.ok) {
      upstream.body?.cancel().catch(() => {})
      const error = new Error(`responded ${upstream.status}`)
      error.phase = phase
      error.status = upstream.status
      throw error
    }

    const contentType = upstream.headers.get('content-type') || ''

    /* Only images are proxied — video/audio redirect to the gateway and stream from there */
    if (!contentType.startsWith('image/')) {
      upstream.body?.cancel().catch(() => {})
      return { url, contentType, buffer: null }
    }

    clearTimeout(timer)
    phase = 'body'

    return { url, contentType, buffer: await drainBody(upstream, { deadline, abort: cancel }) }
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      const cancelled = signal?.aborted === true && !error.stalled
      const timeout = new Error(cancelled ? 'cancelled' : error.stalled ? error.message : `timed out waiting for ${phase}`)
      timeout.name = cancelled ? 'CancelledError' : 'TimeoutError'
      timeout.phase = phase
      timeout.stalled = error.stalled === true
      throw timeout
    }
    error.phase ??= phase
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}

/**
 * Asks the primary gateway, then races the fallbacks. When every gateway fails, the rejection
 * carries `gateway: true`, and `unresolvable: true` if none of them ever started sending the
 * content — the one outcome that says something about the CID rather than about the network.
 * @param {string} cid Content address to resolve.
 * @returns {Promise<{url: string, contentType: string, buffer: Buffer|null}>} See fetchGateway.
 */
async function fetchFromGateways(cid) {
  const deadline = Date.now() + TOTAL_FETCH_BUDGET_MS
  const [primary, ...fallbacks] = gatewayList()
  const attempts = []
  const hostOf = (gateway) => gateway.replace(/^https?:\/\//, '').split('/')[0]
  const failed = (gateway, error) => {
    attempts.push({ host: hostOf(gateway), error })
    console.warn(`IPFS_GATEWAY_FAILED ${hostOf(gateway)} ${error.message}:`, cid)
  }

  if (primary) {
    try {
      return await fetchGateway(`${primary}${cid}`, { headersMs: PRIMARY_HEADERS_TIMEOUT_MS, deadline })
    } catch (error) {
      failed(primary, error)
    }
  }

  /* The fallbacks race rather than queue: the caller has already waited out the primary, and
     a CID nobody has would otherwise cost every fallback's patience in a row. The first to
     deliver wins and the rest are aborted to free their sockets — a loser cancelled that way
     is not a failed attempt and says nothing about the CID. */
  if (fallbacks.length && deadline - Date.now() >= MIN_ATTEMPT_MS) {
    const losers = new AbortController()
    try {
      return await Promise.any(
        fallbacks.map((gateway) =>
          fetchGateway(`${gateway}${cid}`, { headersMs: FALLBACK_HEADERS_TIMEOUT_MS, deadline, signal: losers.signal }).catch((error) => {
            if (!losers.signal.aborted) failed(gateway, error)
            throw error
          }),
        ),
      )
    } catch {
      /* AggregateError — every fallback has already recorded itself above */
    } finally {
      losers.abort()
    }
  }

  const failure = new Error(attempts.map(({ host, error }) => `${host} ${error.message}`).join('; ') || 'no IPFS gateway configured')
  failure.name = attempts.some(({ error }) => error.name === 'TimeoutError') ? 'TimeoutError' : 'GatewayError'
  failure.gateway = true
  /* Reached every gateway, and not one of them could produce the content: each either hung or
     refused before sending a byte, or started sending and went quiet with the file unfinished.
     Both are facts about the content — nobody holds all of its blocks — where a connection
     error, or a transfer that simply ran out of the chain's budget while still moving, is only
     a fact about our side of the network. */
  failure.unresolvable =
    attempts.length > 0 &&
    attempts.every(
      ({ error }) => error.stalled === true || (error.phase === 'headers' && (error.name === 'TimeoutError' || error.status)),
    )
  throw failure
}

/**
 * Writes a failed resolve into every cache it belongs in and shapes the entry to serve.
 *
 * Three classes, believed for different lengths:
 * - Unresolvable: no gateway could produce the content — none ever started sending it, or the
 *   ones that did went quiet with the file unfinished. That says something about the CID
 *   (unpinned, partially pinned, mistyped), so it goes to the durable store too, and is held
 *   for the full TTL.
 * - Transient: a gateway had the content and was still delivering it when the budget ran out,
 *   or was reachable only to error. That says something about this minute, so it is held
 *   briefly, in-process only.
 * - Ours: sharp or heic-convert rejected the bytes. A deploy fixes this class and a deploy
 *   restarts the process, so in-process for the full TTL is exactly right.
 * @param {Object} params
 * @param {string} params.cacheKey Identity of the entry.
 * @param {string} params.cid Content address, kept alongside for triage.
 * @param {Error} params.error What went wrong.
 * @returns {Promise<{kind: 'error', status: number, message: string, ttlMs: number}>} The
 * entry, already written to cache.
 */
async function recordFailure({ cacheKey, cid, error }) {
  const gateway = error.gateway === true
  const timedOut = error.name === 'TimeoutError'
  const status = timedOut ? 504 : gateway ? 502 : 500
  const message = gateway ? `IPFS gateway: ${error.message}` : error.message || 'Internal Server Error'
  const ttlMs = gateway && !error.unresolvable ? TRANSIENT_FAILURE_TTL_MS : FAILURE_TTL_MS

  if (!gateway) console.error('IPFS_API_ROUTE_ERROR:', error)
  else console.warn(error.unresolvable ? 'IPFS_UNRESOLVABLE:' : 'IPFS_GATEWAY_TRANSIENT:', cid, '—', error.message)

  writeMediaFailure(cacheKey, status, message, ttlMs)

  /* Only the class that will still be true on the next cold start goes in the database: the
     in-process record dies with this process, and on a serverless deployment that is often
     one request. A slow transfer is not that class — the next instance should try again. */
  if (error.unresolvable) await recordDurableFailure({ cacheKey, cid, status, message })

  return { kind: 'error', status, message, ttlMs }
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
  try {
    const { url, buffer: fetched } = await fetchFromGateways(cid)

    /* Only images go through sharp — video/audio stream straight from whichever gateway had it */
    if (!fetched) {
      writeMediaRedirect(cacheKey, url)
      return { kind: 'redirect', location: url }
    }

    let buffer = fetched

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
              ...(isAnimated ? webpAnimationOptions(metadata) : {}),
            })
            .toBuffer()

    const outputType = format === 'jpeg' ? 'image/jpeg' : 'image/webp'
    writeMediaBody(cacheKey, optimizedBuffer, outputType)
    return { kind: 'body', body: optimizedBuffer, contentType: outputType }
  } catch (error) {
    return recordFailure({ cacheKey, cid, error })
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
         TOTAL_FETCH_BUDGET_MS, on every cold start, for as long as the CID stays unpinned. */
      const known = await readDurableFailure(cacheKey)
      if (known) {
        writeMediaFailure(cacheKey, known.status, known.message)
        return { kind: 'error', ...known }
      }

      return resolveMedia({ cacheKey, cid, width, quality, format, stillOnly })
    }),
  )
}

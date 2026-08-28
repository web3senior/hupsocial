// app/api/ipfs/file/route.js

import { after, NextResponse } from 'next/server'
import { PinataSDK } from 'pinata'
import sharp from 'sharp'
import { webpAnimationOptions } from '@/lib/webpAnimation'
import { bothProvidersFailed, shortUploadError } from '@/lib/uploadErrors'
import { addToFilebase } from '@/lib/filebase'
import { gatewayList, gatewayUrl } from '@/lib/ipfsGateways'
import { DEAD_FAILURE_TTL_MS, DISCOVERY_FAILURE_TTL_MS, FAILURE_TTL_MS, TRANSIENT_FAILURE_TTL_MS, coalesceMedia, readMedia, writeMediaBody, writeMediaFailure, writeMediaRedirect } from '@/lib/mediaCache'
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
/* The GET answers inside RESPONSE_DEADLINE_MS, but the resolve it hands to `after()` may still
   be racing gateways and encoding well past that; this is the ceiling that work runs under.
   Without it the platform's default (10–15s without Fluid Compute) could kill an instance
   mid-fetch, losing the cache entry the next visitor was going to be served from. */
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
    const url = gatewayUrl(rawCID)
    console.log('Upload complete. CID:', cid)
    return NextResponse.json({ url, cid }, { status: 200 })
  } catch (e) {
    console.error('File upload error:', e)
    return NextResponse.json({ error: shortUploadError(e, 'Upload failed on the server') }, { status: 500 })
  }
}

// One deadline, because every gateway is now asked at the same time.
//
// This used to be two, and they were spent in series: the primary got 8s to find the content
// and the fallbacks got 5s each afterwards. That ordering assumed the primary is the host most
// likely to have the CID, which is true only of content we uploaded. Third-party art — every
// NFT collection icon, every profile picture minted elsewhere — is pinned in someone else's
// account, and for all of it we spent 8 seconds waiting on a host that was never going to
// answer before asking one that could. Measured across the NFT market's collection icons:
// 9.2s to resolve eleven of them, five falsely reported dead. Raced instead, the live ones came
// back in 165–1852ms, and Filebase still won four of six — it was never slow, we were just
// asking it alone and first.
//
// The HEADERS/BODY split survives, because it still guards two different waits. Waiting for
// headers is waiting to learn whether a gateway has the content at all. Waiting for the body is
// downloading a file it has already found, and a 3.6MB camera original takes several seconds on
// a good day. One budget for both meant a slow transfer read as "unresolvable" and got the CID
// negatively cached on every instance — which is what "some images don't load" turned out to be.
//
// Deliberately under RESPONSE_DEADLINE_MS, and that gap is load-bearing. A race that fails still
// has to classify the failure and write it down, and if it is only finishing as the response
// deadline fires, the caller is handed the uncacheable "still resolving" answer instead of the
// verdict — so a CID known to be gone would be re-proved on every single view. Half a second is
// ample for the classification and the row behind it.
//
// Only the headers phase is bounded here, so a slow BODY is not cut off by it: the 936KB icon
// that took 2.29s end to end answered its headers in a fraction of that and then streamed under
// the stall clock below.
const GATEWAY_HEADERS_TIMEOUT_MS = 2000
/* The body phase is timed on PROGRESS, not on total elapsed time, because a flat ceiling
   cannot tell the two body failures apart. A big file arriving slowly and a file that stops
   arriving both hit 15s; only one of them says anything about the CID. Partially-pinned
   content is the case that matters: a UP profile picture whose first UnixFS leaf survives and
   whose other eight blocks are gone streams ~232KB of its declared 1.98MB from every gateway
   and then goes silent forever. So the clock restarts on every chunk — a slow transfer keeps
   buying time as long as bytes keep coming, and a stall is caught in a fraction of the old
   ceiling and reported for what it is. */
const BODY_STALL_TIMEOUT_MS = 6000
/* Ceiling for the whole resolve — the one race for headers plus however long a slow body is
   allowed to take — so the encode still fits inside maxDuration after it. Generous on purpose,
   and no longer felt by anyone: since the response has its own deadline below, whatever is left
   of this budget is spent after the browser has already been answered. What it buys is headroom
   for the biggest sources we serve — an animated GIF profile picture runs to double digits of
   megabytes, and cutting its transfer short cached a transient failure for a picture that was
   arriving perfectly well. */
const TOTAL_FETCH_BUDGET_MS = 32000

/* How long a REQUEST may wait, as opposed to how long a resolve may take. The two used to be
   the same number, which is why an unreachable CID read to the visitor as a slow product: the
   page sat on six occupied sockets waiting out a gateway chain it could do nothing about.
   Past this, the request is answered and the resolve carries on into the cache behind it, so
   the wait is paid once by nobody and the next view of that image is a memory read.
   Set just above the slowest live icon measured (1852ms) so a raced success almost always
   lands inside it rather than being handed off. */
const RESPONSE_DEADLINE_MS = 2500

/* A provider lookup is cheap and definitive in a way a gateway failure is not, so it is what
   separates "gone" from "nobody answered in time". The DHT is asked who is advertising the CID
   at all; zero providers means no host on the network claims to hold it, and no amount of
   retrying will change that. Four of the NFT market's eleven collection icons are in this state
   — the creators' pins lapsed and the last copy went with them. */
const ROUTING_ENDPOINT = 'https://delegated-ipfs.dev/routing/v1/providers/'
const ROUTING_TIMEOUT_MS = 2000

/* The host list lives in lib/ipfsGateways so the article body reader and this proxy can never
   drift onto different gateways. They consume it differently on purpose: a reader walking it in
   order wants the preferred host first, while this route asks all of them at once and takes
   whoever answers, so the ordering is advisory here rather than a queue. */

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

/* What a gateway says when it has looked rather than merely failed to look. 400 belongs with
   them: a CID it cannot even parse will not become parseable later. */
const DEFINITIVE_STATUSES = new Set([400, 404, 410, 451])

/**
 * Asks every gateway at once and takes the first delivery. When all of them fail, the rejection
 * carries `gateway: true` plus the verdict: `unresolvable` when every host answered about the
 * content itself, `undiscovered` when they merely never found it in time. Neither flag is set
 * for the network's own bad minute — see the comment on the classification below.
 * @param {string} cid Content address to resolve.
 * @returns {Promise<{url: string, contentType: string, buffer: Buffer|null}>} See fetchGateway.
 */
async function fetchFromGateways(cid) {
  const deadline = Date.now() + TOTAL_FETCH_BUDGET_MS
  const gateways = gatewayList()
  const attempts = []
  const hostOf = (gateway) => gateway.replace(/^https?:\/\//, '').split('/')[0]

  /* Every gateway at once, first delivery wins, losers aborted to free their sockets. There is
     no ordering to preserve here: a gateway either holds the blocks or it does not, and asking
     the others only after the first has timed out spends the visitor's time learning something
     they could have learned in parallel. A loser cancelled this way is not a failed attempt and
     says nothing about the CID, so it is not recorded. */
  const losers = new AbortController()
  try {
    return await Promise.any(
      gateways.map((gateway) =>
        fetchGateway(`${gateway}${cid}`, { headersMs: GATEWAY_HEADERS_TIMEOUT_MS, deadline, signal: losers.signal }).catch((error) => {
          if (!losers.signal.aborted) {
            attempts.push({ host: hostOf(gateway), error })
            console.warn(`IPFS_GATEWAY_FAILED ${hostOf(gateway)} ${error.message}:`, cid)
          }
          throw error
        }),
      ),
    )
  } catch {
    /* AggregateError — every attempt has already recorded itself above */
  } finally {
    losers.abort()
  }

  const failure = new Error(attempts.map(({ host, error }) => `${host} ${error.message}`).join('; ') || 'no IPFS gateway configured')
  failure.name = attempts.some(({ error }) => error.name === 'TimeoutError') ? 'TimeoutError' : 'GatewayError'
  failure.gateway = true

  /* Nothing arrived from anywhere — but that covers two different facts, and treating them as
     one is what kept working profile pictures dark for half an hour.

     A gateway that answers 404/410/451 has looked and is telling us about the CONTENT, and a
     transfer that started and went quiet says the same thing in the other direction: somebody
     holds the first block and nobody holds the rest. Those are durable facts.

     A gateway that times out, 5xx's or rate-limits never got that far. Filebase spells it out —
     `no providers found for the CID (phase: provider discovery)` — and a provider that is merely
     slow or briefly unreachable is indistinguishable, in that one answer, from one that is gone.
     It is a fact about the minute, and the next attempt is what separates them. */
  const definitive = ({ error }) => error.stalled === true || (error.phase === 'headers' && DEFINITIVE_STATUSES.has(error.status))
  const answered = ({ error }) => error.phase === 'headers' && (error.name === 'TimeoutError' || Boolean(error.status))

  failure.unresolvable = attempts.length > 0 && attempts.every(definitive)
  /* Mixed evidence lands here rather than above: one host's 404 does not make the other two
     hosts' timeouts an answer about the content. */
  failure.undiscovered = !failure.unresolvable && attempts.length > 0 && attempts.every((attempt) => definitive(attempt) || answered(attempt))
  throw failure
}

/**
 * Asks the DHT who is advertising this content, which is the one question a gateway failure
 * cannot answer. Gateways report their own luck; this reports whether anybody on the network
 * claims to hold the blocks at all.
 *
 * Started alongside the gateway race and read only if that race loses, so it costs no latency
 * on the path that matters. A lookup that itself fails returns null rather than false — not
 * knowing is not the same as knowing there is nothing, and only the second is worth writing
 * down for hours.
 * @param {string} cid Content address, possibly carrying a subpath.
 * @returns {Promise<boolean|null>} Whether any provider was found, or null if nobody could say.
 */
async function hasProviders(cid) {
  /* Providers are advertised for the root block; a `bafy…/0-profile.png` subpath is a lookup
     inside content the root already covers. */
  const root = String(cid).split('/')[0]
  if (!root) return null

  try {
    const response = await fetch(`${ROUTING_ENDPOINT}${root}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(ROUTING_TIMEOUT_MS),
    })
    if (!response.ok) return null

    const body = await response.json()
    return (body?.Providers?.length ?? 0) > 0
  } catch {
    return null
  }
}

/**
 * Writes a failed resolve into every cache it belongs in and shapes the entry to serve.
 *
 * Five classes, believed for different lengths:
 * - Dead: the DHT knows of no provider for the CID. Nobody on the network holds these blocks,
 *   so no retry can succeed and the only honest answer is a placeholder — held for hours, and
 *   written durably so a cold instance shows it instantly rather than relearning it.
 * - Unresolvable: every gateway answered about the content — refused it outright, or started
 *   sending and went quiet with the file unfinished. That says something about the CID
 *   (unpinned, partially pinned, mistyped), so it goes to the durable store too, and is held
 *   for the full TTL.
 * - Undiscovered: no gateway found it in time. Likely the same CID as above, and just as
 *   likely a provider having a bad few minutes, so it is remembered — a cold instance should
 *   not re-pay the fetch budget the last one just spent — but only briefly.
 * - Transient: a gateway had the content and was still delivering it when the budget ran out,
 *   or was reachable only to error. That says something about this minute, so it is held
 *   briefly, in-process only.
 * - Ours: sharp or heic-convert rejected the bytes. A deploy fixes this class and a deploy
 *   restarts the process, so in-process for the full TTL is exactly right.
 *
 * The status doubles as the class, because the durable store reads it back and must hold the
 * gateway classes for different lengths: 410 for content the network has no provider for, 502
 * for a gateway that answered, 504 for one that never found it. Keep these in step with
 * lib/mediaFailureStore.js.
 * @param {Object} params
 * @param {string} params.cacheKey Identity of the entry.
 * @param {string} params.cid Content address, kept alongside for triage.
 * @param {Error} params.error What went wrong.
 * @param {boolean|null} params.providers Whether the DHT knows a provider — false is the one
 * value that proves the content itself is gone; null means the lookup could not say.
 * @returns {Promise<{kind: 'error', status: number, message: string, ttlMs: number}>} The
 * entry, already written to cache.
 */
async function recordFailure({ cacheKey, cid, error, providers = null }) {
  const gateway = error.gateway === true
  /* Outranks the gateway verdicts below: they describe who failed to deliver, this describes
     whether there was ever anything to deliver. */
  const dead = gateway && providers === false
  const unresolvable = !dead && error.unresolvable === true
  const undiscovered = !dead && error.undiscovered === true
  const status = !gateway ? 500 : dead ? 410 : unresolvable ? 502 : 504
  const message = dead
    ? 'IPFS: no provider holds this content — it is unpinned everywhere on the network'
    : gateway
      ? `IPFS gateway: ${error.message}`
      : error.message || 'Internal Server Error'
  const ttlMs = dead ? DEAD_FAILURE_TTL_MS : !gateway || unresolvable ? FAILURE_TTL_MS : undiscovered ? DISCOVERY_FAILURE_TTL_MS : TRANSIENT_FAILURE_TTL_MS

  if (!gateway) console.error('IPFS_API_ROUTE_ERROR:', error)
  else console.warn(dead ? 'IPFS_DEAD:' : unresolvable ? 'IPFS_UNRESOLVABLE:' : undiscovered ? 'IPFS_UNDISCOVERED:' : 'IPFS_GATEWAY_TRANSIENT:', cid, '—', error.message)

  writeMediaFailure(cacheKey, status, message, ttlMs)

  /* Only the classes that will still be true on the next cold start go in the database: the
     in-process record dies with this process, and on a serverless deployment that is often one
     request. A slow transfer is not that class — the next instance should try again. A dead CID
     emphatically is, for as long as the store holds its 410s.

     Recorded per cache key rather than per CID, so a dead address is relearned once per width
     it is asked at. Cheap enough to leave: the relearning happens behind the response deadline,
     where nobody is waiting on it. */
  if (dead || unresolvable || undiscovered) await recordDurableFailure({ cacheKey, cid, status, message })

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
  /* Started here rather than inside the failure path so it overlaps the race instead of adding
     to it. On the happy path its answer is simply never read. */
  const providers = hasProviders(cid)

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
    return recordFailure({ cacheKey, cid, error, providers: await providers })
  }
}

/**
 * Resolves with the promise's value, or with null once the deadline passes — whichever comes
 * first. The promise is deliberately NOT cancelled: it is the resolve that will populate the
 * cache, and abandoning it at the deadline would mean the next request starts from nothing and
 * waits all over again. The caller hands it to `after()` so the platform keeps it alive.
 * @param {Promise<any>} promise The work to wait on.
 * @param {number} ms How long the caller is willing to wait.
 * @returns {Promise<any|null>} The value, or null if the deadline won.
 */
function withDeadline(promise, ms) {
  let timer
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })

  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

/**
 * The answer when the resolve is still running. Deliberately uncacheable at every layer: the
 * work it stands in for is about to finish, and caching "not yet" would outlive the fact.
 * A non-2xx is what an <img> needs to fire onError and paint the placeholder, so the visitor
 * sees a settled picture rather than a spinner.
 * @returns {Response} A 504 nobody is allowed to remember.
 */
function stillResolving() {
  return NextResponse.json(
    { error: 'Still resolving from IPFS — retry shortly' },
    { status: 504, headers: { 'Cache-Control': 'no-store' } },
  )
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
  const resolving = coalesceMedia(cacheKey, async () => {
    /* An address this process has never seen may still be one another instance has already
       proved unresolvable. Reading that costs a primary-key lookup; not reading it costs
       TOTAL_FETCH_BUDGET_MS, on every cold start, for as long as the CID stays unpinned. */
    const known = await readDurableFailure(cacheKey)
    if (known) {
      writeMediaFailure(cacheKey, known.status, known.message)
      return { kind: 'error', ...known }
    }

    return resolveMedia({ cacheKey, cid, width, quality, format, stillOnly })
  })

  const entry = await withDeadline(resolving, RESPONSE_DEADLINE_MS)
  if (entry) return respond(entry)

  /* The deadline won, so the visitor gets a placeholder now and the real answer on their next
     look. `after` hands the unfinished resolve to the platform's waitUntil so a serverless
     instance is not torn down mid-fetch; where no waitUntil exists it throws, and that is fine
     — a long-lived server keeps the promise running on its own, which is all this needs. */
  console.warn('IPFS_SLOW_RESOLVE handed off past the response deadline:', cid)
  try {
    after(resolving)
  } catch {
    /* No waitUntil in this environment — the resolve continues in-process regardless */
  }

  return stillResolving()
}

/**
 * @file lib/mediaCache.js
 * @description Process-local cache for the media proxies (`/api/ipfs/file` and friends).
 *
 * The proxies turn a content address into optimized bytes, which is a pure function of the
 * address and the transform params — so the answer is worth keeping. Without a cache, a page
 * of thumbnails re-fetches every one of them from the gateway and re-runs sharp on every
 * cold load, for every visitor.
 *
 * Four things live here, and the third is the one that actually hurts without it:
 *
 * 1. A bounded LRU of encoded bodies, so a repeat request is a memory read.
 * 2. In-flight coalescing, so twenty cards pointing at the same CID open one socket, not
 *    twenty. React's StrictMode double-effect alone doubles this in development.
 * 3. A NEGATIVE cache. Unpinned content is normal on IPFS and never resolves — the gateway
 *    simply never answers, and the proxy eats its whole timeout before giving up. Browsers
 *    open ~6 connections per origin, so a handful of dead CIDs on one page starve every
 *    other image behind them. Remembering the failure turns that from "8 seconds, every
 *    render, forever" into "8 seconds once".
 * 4. A short-lived cache of ORIGINALS, so the four widths one avatar is asked at share the
 *    single download between them rather than paying for it four times over.
 *
 * In memory rather than on disk: Vercel's filesystem is read-only outside /tmp, and the
 * success path already ships an immutable `s-maxage` for the shared CDN cache. This is the
 * layer under that one — it catches hard reloads, cache-busting crawlers, and the failures
 * a CDN was never told to hold.
 *
 * The negative cache has a durable sibling in lib/mediaFailureStore.js, because everything
 * here dies with the process — and on a serverless deployment that is often one request.
 * This layer answers a repeat within an instance; that one answers a cold start.
 */

/** Total encoded bytes held. Thumbnails run 0.5–30KB, so this is thousands of them. */
const MAX_BYTES = 96 * 1024 * 1024

/** Entry ceiling, so a stampede of misses can't grow the map without bound on tiny bodies. */
const MAX_ENTRIES = 4000

/**
 * One body big enough to evict most of the cache is not worth caching — a 4096px original
 * would flush a page of thumbnails to serve one request that the CDN header already covers.
 *
 * Animated profile pictures are what sets the figure. A long GIF avatar re-encodes to an
 * animated WebP of several megabytes at the top rung, and a body over this ceiling is served
 * but never held — so every cold instance re-ran the gateway fetch and the per-frame encode
 * for a picture the whole feed shows. Raised to cover them, with the total budget raised
 * alongside it so one such avatar still cannot be more than a sixth of the cache.
 */
const MAX_ENTRY_BYTES = 16 * 1024 * 1024

/**
 * The same ceiling for an ORIGINAL — the bytes exactly as the gateway served them, held so the
 * ladder rungs can share one download. Higher than the encoded ceiling because an original is
 * the expensive thing here and an encode is not: the GIF avatar in our own users table is
 * 13.6MB and takes 9.9s to pull, and re-encoding it at another width costs 188ms.
 */
const MAX_SOURCE_BYTES = 32 * 1024 * 1024

/**
 * How long an original is kept after the fetch that paid for it.
 *
 * Nothing about a CID's bytes goes stale, so this is not a correctness window — it is how long
 * the other rungs have to arrive. A profile picture is asked for at 48, 96, 192 and 384 within
 * one page load, and once all four are encoded the original is so much dead weight: several
 * megabytes of GIF holding a share of the budget that thumbnails could be using.
 */
const SOURCE_TTL_MS = 5 * 60 * 1000

/**
 * How long a failure is believed. Long enough that a page of dead CIDs costs its timeout
 * once rather than once per render, short enough that content pinned five minutes ago shows
 * up without a deploy.
 */
export const FAILURE_TTL_MS = 10 * 60 * 1000

/**
 * How long a failure that says something about the minute rather than the address is
 * believed — a gateway that had the content but couldn't deliver it in time. Long enough to
 * stop a page of cards re-asking in a loop, short enough that the next visitor gets a retry.
 */
export const TRANSIENT_FAILURE_TTL_MS = 60 * 1000

/**
 * How long "no gateway could find it in time" is believed — the middle class, and the one
 * that was being mistaken for the first.
 *
 * Filebase names the phase in its own error: `no providers found for the CID (phase: provider
 * discovery)`. That is not the same statement as "this content does not exist" — a provider
 * that is slow, asleep or briefly unreachable produces it exactly like one that is gone
 * forever, and the difference only shows up on the next attempt. Two Universal Profile
 * pictures made the point: every gateway gave up on them, and both were serving again a few
 * minutes later, having been held as unresolvable in the meantime.
 *
 * So it is remembered — a cold instance should not re-pay the whole fetch budget for a CID
 * the last one just failed on — but only for as long as the fact is likely to still be true.
 */
export const DISCOVERY_FAILURE_TTL_MS = 3 * 60 * 1000

/**
 * How long "the network has no provider for this" is believed — the class the three above were
 * all guessing at.
 *
 * The others are inferred from how gateways behaved, which is why they are held for minutes: a
 * gateway that failed to find something is reporting its own luck, and luck changes. This one
 * is a different kind of statement. The DHT was asked who advertises the CID and answered with
 * nobody, so there is no host to have a better minute later — the last pin lapsed and the bytes
 * went with it. Four of the NFT market's eleven collection icons are in exactly this state.
 *
 * Hours rather than forever, because a creator can re-pin, and because a provider record can be
 * missing from the routing layer for reasons of its own. A day of showing the placeholder for
 * something that came back is a fair price for never again spending the fetch budget on content
 * that is gone.
 */
export const DEAD_FAILURE_TTL_MS = 12 * 60 * 60 * 1000

// Pinned to globalThis so `next dev`'s module reloading doesn't drop the cache — and with it
// the memory of which CIDs are dead — on every edit. Same reasoning as the db pool.
const globalForMedia = globalThis
const store = globalForMedia.__hupMediaCache ?? new Map()
const inflight = globalForMedia.__hupMediaInflight ?? new Map()
globalForMedia.__hupMediaCache = store
globalForMedia.__hupMediaInflight = inflight

let heldBytes = globalForMedia.__hupMediaBytes ?? 0

const setHeldBytes = (value) => {
  heldBytes = value
  globalForMedia.__hupMediaBytes = value
}

/**
 * Drops the oldest entries until the cache is back inside both budgets. Map iterates in
 * insertion order and a hit re-inserts, which is the whole LRU.
 */
function evict() {
  for (const [key, entry] of store) {
    if (heldBytes <= MAX_BYTES && store.size <= MAX_ENTRIES) break
    store.delete(key)
    setHeldBytes(heldBytes - (entry.bytes || 0))
  }
}

/**
 * Reads an entry, refreshing its recency. Expired negatives are dropped and read as a miss,
 * so the next caller retries the gateway.
 * @param {string} key Cache key — must encode every param the body depends on.
 * @returns {{kind: 'body'|'redirect'|'error'}|null} The entry, or null on a miss.
 */
export function readMedia(key) {
  const entry = store.get(key)
  if (!entry) return null

  if (entry.expiresAt && entry.expiresAt <= Date.now()) {
    store.delete(key)
    setHeldBytes(heldBytes - (entry.bytes || 0))
    return null
  }

  store.delete(key)
  store.set(key, entry)
  return entry
}

/**
 * Stores a successfully encoded body.
 * @param {string} key Cache key.
 * @param {Buffer} body Encoded bytes, ready to serve.
 * @param {string} contentType Mime type the body was encoded to.
 */
export function writeMediaBody(key, body, contentType) {
  if (body.length > MAX_ENTRY_BYTES) return
  store.set(key, { kind: 'body', body, contentType, bytes: body.length })
  setHeldBytes(heldBytes + body.length)
  evict()
}

/**
 * The key an original is held under. Namespaced away from the encode keys, which start with the
 * CID, so the two can never be read for each other.
 * @param {string} cid Content address the bytes were fetched for.
 * @returns {string} The cache key — also the right key to coalesce the fetch on.
 */
export function mediaSourceKey(cid) {
  return `source|${cid}`
}

/**
 * Reads the original bytes of a CID, if the fetch that paid for them was recent enough.
 * @param {string} cid Content address.
 * @returns {{url: string, contentType: string, buffer: Buffer}|null} The gateway's answer, or
 * null on a miss.
 */
export function readMediaSource(cid) {
  const entry = readMedia(mediaSourceKey(cid))
  return entry?.kind === 'source' ? entry : null
}

/**
 * Stores the original bytes of a CID so the other widths don't re-download them.
 *
 * The proxy caches per encode key — cid, width, quality, still, format — which is right for
 * what it serves and wrong for what it fetches: the same original was pulled again for every
 * rung of the avatar ladder. On a 13.6MB GIF profile picture that is four 9.9s downloads for
 * one picture, and only the first rung anyone looked at ever made it inside a response.
 * @param {string} cid Content address the bytes were fetched for.
 * @param {{url: string, contentType: string, buffer: Buffer}} source The gateway's answer.
 */
export function writeMediaSource(cid, { url, contentType, buffer }) {
  if (buffer.length > MAX_SOURCE_BYTES) return

  const key = mediaSourceKey(cid)
  /* Replacing an entry, not adding one, if the same original is written twice — and at
     megabytes apiece an unsubtracted original would have the budget evicting thumbnails to make
     room for bytes it is no longer holding */
  setHeldBytes(heldBytes - (store.get(key)?.bytes || 0))
  store.set(key, { kind: 'source', url, contentType, buffer, bytes: buffer.length, expiresAt: Date.now() + SOURCE_TTL_MS })
  setHeldBytes(heldBytes + buffer.length)
  evict()
}

/**
 * Stores a passthrough redirect — non-image content the proxy hands back to the gateway.
 * @param {string} key Cache key.
 * @param {string} location Absolute URL to redirect to.
 */
export function writeMediaRedirect(key, location) {
  store.set(key, { kind: 'redirect', location, bytes: 0 })
  evict()
}

/**
 * Remembers that this key could not be resolved.
 * @param {string} key Cache key.
 * @param {number} status HTTP status to replay.
 * @param {string} message Error message to replay.
 * @param {number} [ttlMs] How long to believe it — FAILURE_TTL_MS unless the failure was
 * transient, in which case TRANSIENT_FAILURE_TTL_MS. Kept on the entry so the response can
 * advertise the same window downstream.
 */
export function writeMediaFailure(key, status, message, ttlMs = FAILURE_TTL_MS) {
  store.set(key, { kind: 'error', status, message, ttlMs, bytes: 0, expiresAt: Date.now() + ttlMs })
  evict()
}

/**
 * Runs `producer` at most once per key at a time — concurrent callers await the same
 * promise. Nothing is cached here; the producer decides what to write, because only it
 * knows whether the result was a body, a redirect, or a failure worth remembering.
 * @param {string} key Cache key.
 * @param {() => Promise<any>} producer Does the real work on a miss.
 * @returns {Promise<any>} Whatever the producer resolved to.
 */
export function coalesceMedia(key, producer) {
  const pending = inflight.get(key)
  if (pending) return pending

  const promise = (async () => producer())().finally(() => inflight.delete(key))
  inflight.set(key, promise)
  return promise
}

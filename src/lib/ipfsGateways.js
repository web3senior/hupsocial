/* Where IPFS bytes come from. Filebase leads every list because it is where our uploads pin: it
   holds the blocks before any other host has ever heard of the CID, it is the one gateway of the
   three that honours HTTP ranges, and it is the one we can put a dedicated (unmetered, directly
   peered) endpoint in front of. The configured gateways follow, then the public resolvers, so a
   bad minute at one host no longer decides whether content loads. */
const FILEBASE_GATEWAY = 'https://ipfs.filebase.io/ipfs/'
/* Pinata rides along because it is where content we did NOT upload actually lives. A DHT
   provider lookup on the NFT market's collection icons names bitswap.pinata.cloud for most of
   the ones still reachable: creators pinned their own artwork to their own Pinata accounts, and
   until now no gateway in this list was the host holding it — we were asking Filebase to go
   find blocks over bitswap instead of asking the node that has them. */
const BUILT_IN_FALLBACK_GATEWAYS = [FILEBASE_GATEWAY, 'https://gateway.pinata.cloud/ipfs/']
/* ipfs.io is asked last wherever the environment puts it: it rate-limits hard, and a throttled
   or errored answer from it carries no Access-Control-Allow-Origin header at all. */
const LAST_RESORT_GATEWAYS = ['https://ipfs.io/ipfs/']

/**
 * Puts a configured gateway into the one shape the callers append a CID to.
 * @param {string} gateway Base URL, with or without its trailing slash.
 * @returns {string} The same URL over https and ending in a slash.
 */
function normalize(gateway) {
  /* The fallback var has shipped as http:// — every gateway speaks https, and a mixed
     scheme would only put the same host in the list twice */
  const secure = gateway.replace(/^http:\/\//, 'https://')
  return secure.endsWith('/') ? secure : `${secure}/`
}

/**
 * The gateway every fetch tries first. Env-driven so a Filebase dedicated gateway
 * (`https://<name>.myfilebase.com/ipfs/`) can take over without a code change; the public
 * Filebase gateway is the default, so prod leads with Filebase whether or not the var is set.
 * @returns {string} Base URL ending in a slash, ready for the CID to be appended.
 */
export function primaryGateway() {
  const configured = normalize(process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL_PRIMARY || FILEBASE_GATEWAY)
  return isLastResort(configured) ? FILEBASE_GATEWAY : configured
}

/**
 * Whether a gateway may only ever be asked after every other one.
 * @param {string} gateway A normalized base URL.
 * @returns {boolean} True when it belongs at the end of the list.
 */
function isLastResort(gateway) {
  return LAST_RESORT_GATEWAYS.map(normalize).includes(gateway)
}

/**
 * Resolves a CID against the primary gateway. Use wherever a single URL is handed out — an
 * <img>/<video> src, an upload response — so no caller has to know which host leads.
 * @param {string} cid Bare CID or path, already stripped of its `ipfs://` prefix.
 * @returns {string} A fetchable gateway URL.
 */
export function gatewayUrl(cid) {
  return `${primaryGateway()}${cid}`
}

/**
 * The gateways to try, in order, deduplicated. Shared by the media proxy (/api/ipfs/file), the
 * article body reader (lib/article) and the JSON reader (lib/ipfs) so they can never drift onto
 * different fallbacks.
 * @returns {string[]} Base URLs ending in a slash, ready for the CID to be appended.
 */
export function gatewayList() {
  const configured = [process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL, process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL_FALLBACK]
  const normalized = [primaryGateway(), ...configured, ...BUILT_IN_FALLBACK_GATEWAYS, ...LAST_RESORT_GATEWAYS].filter(Boolean).map(normalize)
  const ordered = [...new Set(normalized)]
  return [...ordered.filter((gateway) => !isLastResort(gateway)), ...ordered.filter(isLastResort)]
}

const DEFAULT_TIMEOUT_MS = 10000

/* A document read from the browser never touches a public gateway. Falling through hosts is what
   makes these readers survive a bad minute, and in the browser it cannot work: a gateway that is
   rate-limiting or erroring answers without an Access-Control-Allow-Origin header, so the read
   dies as a CORS failure instead of moving on — and every host we ask cross-origin logs one of
   those in the console even when another gateway already served the document. Same-origin proxy
   instead, which walks this very list server-side with Filebase leading. */
const DOCUMENT_PROXY_PATH = '/api/ipfs/object'
/* The proxy races the gateways under the caller's own budget; this is the slack it needs to
   report back afterwards, so the browser hears the verdict rather than aborting on top of it. */
const PROXY_GRACE_MS = 3000

const inBrowser = () => typeof window !== 'undefined'

/**
 * Reads a CID through our own origin. Rejects with the shape the gateway readers throw, so
 * callers can still tell "the document is gone" from "no host answered".
 * @param {string} cid Bare CID or path, already stripped of its `ipfs://` prefix.
 * @param {{timeoutMs: number, init: RequestInit}} options Budget and fetch options.
 * @returns {Promise<Response>} The document, its body already buffered by the proxy.
 */
async function fetchThroughProxy(cid, { timeoutMs, init }) {
  const url = `${DOCUMENT_PROXY_PATH}?cid=${encodeURIComponent(cid)}&t=${timeoutMs}`
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs + PROXY_GRACE_MS) })
  if (response.ok) return response

  const detail = await response.json().catch(() => ({}))
  throw Object.assign(new Error(detail.error || `IPFS proxy error: ${response.status}`), {
    status: response.status,
    host: 'ipfs proxy',
    attempted: detail.attempted ?? 0,
    statuses: detail.statuses ?? [],
    timedOut: Boolean(detail.timedOut),
  })
}

/* Leading with one host only helps if it is a preference and never a single point of failure:
   the primary holds our own pins, but a CID somebody else pinned can have it answering 504 for
   content the next gateway serves in a second. So every reader walks the list. */

/**
 * Fetches a CID from the first gateway that answers, in list order. For readers that want the
 * bytes; the media proxy has its own racing version with a per-phase budget. In the browser the
 * read goes through /api/ipfs/object, which does the same walk server-side.
 * @param {string} cid Bare CID or path, already stripped of its `ipfs://` prefix.
 * @param {{timeoutMs?: number, init?: RequestInit}} [options] Per-gateway timeout, fetch options.
 * @returns {Promise<Response>} The first OK response.
 * @throws {Error & {status?: number}} When every gateway failed, carrying the last HTTP status seen.
 */
export async function fetchIPFS(cid, { timeoutMs = DEFAULT_TIMEOUT_MS, init = {} } = {}) {
  if (inBrowser()) return fetchThroughProxy(cid, { timeoutMs, init })

  let lastError = null

  for (const gateway of gatewayList()) {
    const host = gateway.replace(/^https?:\/\//, '').split('/')[0]
    try {
      const response = await fetch(`${gateway}${cid}`, { redirect: 'follow', ...init, signal: AbortSignal.timeout(timeoutMs) })
      if (response.ok) return response

      lastError = Object.assign(new Error(`IPFS gateway error: ${response.status}`), { status: response.status, host })
    } catch (error) {
      const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError'
      lastError = Object.assign(new Error(timedOut ? 'IPFS gateway timed out' : error.message || 'IPFS fetch failed'), { host })
    }
    console.warn(`IPFS_GATEWAY_FAILED ${host} ${lastError.message}:`, cid)
  }

  throw lastError ?? new Error('no IPFS gateway is configured')
}

/* Which host last served a directory. A grid of sixty tokens is sixty documents out of one
   directory, and racing every gateway for each of them is four times the requests for an
   answer the first document already gave. Bounded well inside the caller's budget, so a host
   that has gone bad since costs a fraction of it before the field is opened up again. */
const KNOWN_HOST_TIMEOUT_MS = 4000
const KNOWN_HOST_TTL_MS = 60 * 1000
const knownHosts = new Map()

const knownHostFor = (prefix) => {
  const entry = knownHosts.get(prefix)
  if (!entry) return null
  if (entry.until > Date.now()) return entry.gateway
  knownHosts.delete(prefix)
  return null
}

// Headers are not delivery: a gateway can answer 200 and then stall the bytes, so the body is
// read while the clock is still running rather than after it has been cleared.
const buffered = async (response) => {
  const body = await response.arrayBuffer()
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
}

/**
 * Fetches a CID from every gateway at once and takes the first OK response. For small
 * documents — a collection's metadata JSON — where the wait is the whole cost and no single
 * host is worth waiting on: the primary holds our own pins, and a collection's document is
 * almost never one of those, so it answers 504 within a second while the host that does hold
 * it is never asked. Losers are aborted so their sockets are freed; the winner is read to the
 * end inside the same bound.
 *
 * Given a `prefix`, the host that answered for it last is asked alone first, so a grid of one
 * directory's tokens costs one race and then one request per document.
 *
 * Called from the browser — behind the token-icon and NFT hooks — it races nothing itself: the
 * read goes through /api/ipfs/object and the race happens there.
 * @param {string} cid Bare CID or path, already stripped of its `ipfs://` prefix.
 * @param {{timeoutMs?: number, init?: RequestInit}} [options] Per-gateway timeout, fetch
 * options (`init.signal` is replaced by the race's own).
 * @returns {Promise<Response>} The first OK response, its body already buffered.
 * @throws {Error & {attempted: number, statuses: number[], timedOut: boolean}} When every
 * gateway failed: how many were asked, every HTTP status that came back (a host that never
 * answered contributes none) and whether any of them ran out the clock.
 */
export async function raceIPFS(cid, { timeoutMs = DEFAULT_TIMEOUT_MS, init = {}, prefix = null } = {}) {
  if (inBrowser()) return fetchThroughProxy(cid, { timeoutMs, init })

  const known = prefix ? knownHostFor(prefix) : null
  if (known) {
    try {
      const response = await fetch(`${known}${cid}`, {
        redirect: 'follow',
        ...init,
        signal: AbortSignal.timeout(Math.min(timeoutMs, KNOWN_HOST_TIMEOUT_MS)),
      })
      if (response.ok) return await buffered(response)
    } catch {
      /* Falls through to the full race, which is the only thing that can answer for the CID */
    }
    knownHosts.delete(prefix)
  }

  const attempts = gatewayList().map((gateway) => ({
    gateway,
    url: `${gateway}${cid}`,
    host: gateway.replace(/^https?:\/\//, '').split('/')[0],
    controller: new AbortController(),
    expired: false,
  }))
  const statuses = []

  const run = async (attempt) => {
    const timer = setTimeout(() => {
      attempt.expired = true
      attempt.controller.abort()
    }, timeoutMs)
    try {
      const response = await fetch(attempt.url, { redirect: 'follow', ...init, signal: attempt.controller.signal })
      if (!response.ok) {
        statuses.push(response.status)
        throw Object.assign(new Error(`IPFS gateway error: ${response.status}`), { status: response.status })
      }
      return { response: await buffered(response), attempt }
    } catch (error) {
      /* A loser cancelled because another host delivered says nothing about the CID */
      if (attempt.controller.signal.aborted && !attempt.expired) throw error
      console.warn(`IPFS_GATEWAY_FAILED ${attempt.host} ${attempt.expired ? 'timed out' : error.message}:`, cid)
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  let winner = null
  try {
    winner = await Promise.any(attempts.map(run))
  } catch {
    /* AggregateError — every attempt has already recorded itself above */
  } finally {
    for (const attempt of attempts) {
      if (attempt !== winner?.attempt && !attempt.controller.signal.aborted) attempt.controller.abort()
    }
  }

  if (winner) {
    if (prefix) knownHosts.set(prefix, { gateway: winner.attempt.gateway, until: Date.now() + KNOWN_HOST_TTL_MS })
    return winner.response
  }

  throw Object.assign(new Error(attempts.length ? 'no IPFS gateway could serve this content' : 'no IPFS gateway is configured'), {
    attempted: attempts.length,
    statuses,
    timedOut: attempts.some((attempt) => attempt.expired),
  })
}

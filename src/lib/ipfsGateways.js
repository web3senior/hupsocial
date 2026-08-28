/* Where IPFS bytes come from. Filebase leads every list because it is where our uploads pin: it
   holds the blocks before any other host has ever heard of the CID, it is the one gateway of the
   three that honours HTTP ranges, and it is the one we can put a dedicated (unmetered, directly
   peered) endpoint in front of. The configured gateways follow, then the public resolvers, so a
   bad minute at one host no longer decides whether content loads. */
const FILEBASE_GATEWAY = 'https://ipfs.filebase.io/ipfs/'
const BUILT_IN_FALLBACK_GATEWAYS = [FILEBASE_GATEWAY, 'https://ipfs.io/ipfs/']

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
  return normalize(process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL_PRIMARY || FILEBASE_GATEWAY)
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
  const normalized = [primaryGateway(), ...configured, ...BUILT_IN_FALLBACK_GATEWAYS].filter(Boolean).map(normalize)
  return [...new Set(normalized)]
}

const DEFAULT_TIMEOUT_MS = 10000

/* Leading with one host only helps if it is a preference and never a single point of failure:
   the primary holds our own pins, but a CID somebody else pinned can have it answering 504 for
   content the next gateway serves in a second. So every reader walks the list. */

/**
 * Fetches a CID from the first gateway that answers, in list order. For readers that want the
 * bytes; the media proxy has its own racing version with a per-phase budget.
 * @param {string} cid Bare CID or path, already stripped of its `ipfs://` prefix.
 * @param {{timeoutMs?: number, init?: RequestInit}} [options] Per-gateway timeout, fetch options.
 * @returns {Promise<Response>} The first OK response.
 * @throws {Error & {status?: number}} When every gateway failed, carrying the last HTTP status seen.
 */
export async function fetchIPFS(cid, { timeoutMs = DEFAULT_TIMEOUT_MS, init = {} } = {}) {
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

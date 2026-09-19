// Best-effort token logos via GeckoTerminal's public API (no key), server-side only.
// Same contract as prices.js: logos are cosmetic, so every failure path returns an empty
// result and the UI falls back to a monogram.
//
// This is the only logo source that spans the app's EVM chains — LUKSO LSP7s also carry an
// onchain LSP4 icon, which the client prefers when the index supplies one (see luksoAssets.js).

const GECKOTERMINAL_ENDPOINT = 'https://api.geckoterminal.com/api/v2/networks'
const CACHE_TTL_MS = 60 * 60 * 1000 // Branding is effectively static; only re-check hourly
// Measured cold responses run 0.2–2s, so prices.js's 2.5s budget aborted real answers. Logos
// are cached for an hour and the tab renders balances without waiting on them, so a slower
// ceiling costs nothing.
const FETCH_TIMEOUT_MS = 5000

// GeckoTerminal network slugs for the chains it indexes — every app chain but Base Sepolia, which
// is a testnet and will never be listed. Monad and Robinhood were absent when this was written and
// are indexed now, which is worth re-checking against /api/v2/networks rather than assuming.
// Shared with lib/tokenInfo.js and lib/tokenMarkets.js, which read the same upstream.
export const GECKOTERMINAL_NETWORKS = {
  1: 'eth',
  42: 'lukso',
  56: 'bsc',
  143: 'monad',
  // 1868: 'soneium',
  4663: 'robinhood',
  5042: 'arc',
  8453: 'base',
  42161: 'arbitrum',
  42220: 'celo',
}

// The multi-token endpoint caps each request at 30 addresses
const MAX_PER_REQUEST = 30

let cache = { at: 0, logos: new Map(), prices: new Map() }

export const logoKeyFor = (chainId, address) => `${Number(chainId)}:${String(address).toLowerCase()}`

const chunk = (items, size) => {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Resolve logo URLs for a set of (chainId, address) pairs. Returns Map<"chainId:address", url>.
 * Addresses with no listing are simply absent from the result.
 */
export async function fetchTokenLogos(tokens) {
  const wanted = new Map()
  for (const token of tokens) {
    if (!token?.address || !GECKOTERMINAL_NETWORKS[Number(token.chainId)]) continue
    wanted.set(logoKeyFor(token.chainId, token.address), { chainId: Number(token.chainId), address: token.address })
  }
  if (wanted.size === 0) return new Map()

  const fresh = Date.now() - cache.at < CACHE_TTL_MS
  if (!fresh) cache = { at: Date.now(), logos: new Map(), prices: new Map() }

  const missing = [...wanted.entries()].filter(([key]) => !cache.logos.has(key)).map(([, token]) => token)

  if (missing.length > 0) {
    const byChain = new Map()
    for (const token of missing) byChain.set(token.chainId, [...(byChain.get(token.chainId) ?? []), token.address])

    const requests = []
    for (const [chainId, addresses] of byChain) {
      for (const batch of chunk(addresses, MAX_PER_REQUEST)) {
        const url = `${GECKOTERMINAL_ENDPOINT}/${GECKOTERMINAL_NETWORKS[chainId]}/tokens/multi/${batch.join(',')}`
        requests.push(
          fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
            .then((response) => (response.ok ? response.json() : null))
            .then((body) => {
              for (const entry of body?.data || []) {
                const address = entry?.attributes?.address
                const image = entry?.attributes?.image_url
                // GeckoTerminal returns the literal string "missing.png" for unbranded tokens
                if (!address) continue
                // The same response prices the token, which is the only quote there is on the
                // chains DefiLlama does not index (Arc, Robinhood)
                const usd = Number(entry?.attributes?.price_usd)
                if (Number.isFinite(usd) && usd > 0) cache.prices.set(logoKeyFor(chainId, address), usd)
                if (!image || image === 'missing.png') continue
                cache.logos.set(logoKeyFor(chainId, address), image)
              }
            })
            .catch(() => {
              // Leave these keys unresolved — the monogram fallback covers them
            })
        )
      }
    }

    await Promise.all(requests)
    cache.at = Date.now()
  }

  return new Map([...wanted.keys()].filter((key) => cache.logos.has(key)).map((key) => [key, cache.logos.get(key)]))
}

/**
 * USD prices recovered from the same listing lookup, for the chains DefiLlama has no slug for.
 * Call after fetchTokenLogos for the same tokens — it reads that call's cache and makes no
 * request of its own, because the price rode along in the response the logo came from.
 * @returns {Map<string, number>} keyed like logoKeyFor
 */
export function cachedTokenPrices(tokens) {
  const out = new Map()
  for (const token of tokens) {
    if (!token?.address) continue
    const key = logoKeyFor(token.chainId, token.address)
    if (cache.prices.has(key)) out.set(key, cache.prices.get(key))
  }
  return out
}

/**
 * 24h price movement for tokens no price feed covers.
 *
 * GeckoTerminal reports this per POOL, never on the token itself, so each answer costs its own
 * request — which is why the caller passes only the handful it actually needs and this refuses
 * to look up more than a few. The deepest pool is taken as the token's own movement.
 *
 * @param {Array<{chainId: number, address: string}>} tokens
 * @param {number} [limit] Hard ceiling on requests made.
 * @returns {Promise<Map<string, number>>} keyed like logoKeyFor
 */
export async function fetchTokenChange24h(tokens, limit = 4) {
  const wanted = tokens.filter((token) => token?.address && GECKOTERMINAL_NETWORKS[Number(token.chainId)]).slice(0, limit)
  if (wanted.length === 0) return new Map()

  const out = new Map()
  await Promise.all(
    wanted.map(async (token) => {
      const net = GECKOTERMINAL_NETWORKS[Number(token.chainId)]
      const url = `${GECKOTERMINAL_ENDPOINT}/${net}/tokens/${token.address}/pools?page=1`
      try {
        const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
        if (!response.ok) return
        const body = await response.json()
        const deepest = (body?.data ?? [])
          .slice()
          .sort((a, b) => Number(b?.attributes?.reserve_in_usd ?? 0) - Number(a?.attributes?.reserve_in_usd ?? 0))[0]
        const change = Number(deepest?.attributes?.price_change_percentage?.h24)
        if (Number.isFinite(change)) out.set(logoKeyFor(token.chainId, token.address), change)
      } catch {
        // Cosmetic: a row without a movement figure simply shows the price alone
      }
    }),
  )
  return out
}

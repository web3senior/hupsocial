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

// GeckoTerminal network slugs for the chains it indexes. Monad and Robinhood are absent
// (too new/niche) and testnet tokens have no listing, so those simply get no logo.
const GECKOTERMINAL_NETWORKS = {
  1: 'eth',
  42: 'lukso',
  56: 'bsc',
  8453: 'base',
  42161: 'arbitrum',
  42220: 'celo',
}

// The multi-token endpoint caps each request at 30 addresses
const MAX_PER_REQUEST = 30

let cache = { at: 0, logos: new Map() }

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
  if (!fresh) cache = { at: Date.now(), logos: new Map() }

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
                if (!address || !image || image === 'missing.png') continue
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

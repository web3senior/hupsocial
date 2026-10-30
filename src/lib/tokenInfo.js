// Best-effort token profile via the configured LUKSO index and GeckoTerminal (no key),
// server-side only. Same contract as tokenLogos.js: this is reading material, so every
// failure path resolves to null and the UI renders identity-only instead of erroring.

import { GECKOTERMINAL_NETWORKS } from '@/lib/tokenLogos'
import { supportsTokenScan } from '@/lib/luksoAssets'

const GECKOTERMINAL_ENDPOINT = 'https://api.geckoterminal.com/api/v2/networks'
// Prices and volume drift by the minute, but this feeds an info card, not the quote path —
// a minute of staleness is invisible and keeps well inside the public rate limit
const CACHE_TTL_MS = 60 * 1000
const FETCH_TIMEOUT_MS = 5000
// One entry per token anyone has looked at; the cap only bounds a long-lived process
const MAX_CACHE_ENTRIES = 500

const cache = new Map()

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Profile for one token: identity plus the market numbers GeckoTerminal tracks.
 * Resolves to null when the chain isn't indexed, the token has no listing, or the
 * fetch fails — misses are cached too, so a dead token isn't re-asked every render.
 * @param {number|string} chainId
 * @param {string} address
 * @returns {Promise<{name: string|null, symbol: string|null, decimals: number|null,
 *   logo: string|null, priceUsd: number|null, volume24hUsd: number|null,
 *   fdvUsd: number|null, marketCapUsd: number|null, liquidityUsd: number|null}|null>}
 */
export async function fetchTokenInfo(chainId, address) {
  const network = GECKOTERMINAL_NETWORKS[Number(chainId)]
  if (!network || !address) return null

  const key = `${Number(chainId)}:${String(address).toLowerCase()}`
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.info

  let info = null
  // The index retains LSP4 artwork when its original IPFS document is unavailable.
  if (supportsTokenScan(chainId) && process.env.NEXT_PUBLIC_LUKSO_API_ENDPOINT) {
    try {
      const response = await fetch(process.env.NEXT_PUBLIC_LUKSO_API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          query: `query TokenBranding($address: String!) {
            Asset(where: {id: {_eq: $address}, isLSP7: {_eq: true}}, limit: 1) {
              lsp4TokenName
              lsp4TokenSymbol
              icons(limit: 1) { src }
            }
          }`,
          variables: { address: String(address).toLowerCase() },
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      const asset = response.ok ? (await response.json())?.data?.Asset?.[0] : null
      if (asset) info = { name: asset.lsp4TokenName ?? null, symbol: asset.lsp4TokenSymbol ?? null, logo: asset.icons?.[0]?.src || null }
    } catch {
      // Continue with the market source when indexing is unavailable.
    }
  }
  try {
    const response = await fetch(`${GECKOTERMINAL_ENDPOINT}/${network}/tokens/${String(address).toLowerCase()}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (response.ok) {
      const attributes = (await response.json())?.data?.attributes
      if (attributes) {
        const image = attributes.image_url
        info = {
          name: info?.name ?? attributes.name ?? null,
          symbol: info?.symbol ?? attributes.symbol ?? null,
          decimals: toNumber(attributes.decimals),
          // GeckoTerminal returns the literal string "missing.png" for unbranded tokens
          logo: info?.logo || (image && image !== 'missing.png' ? image : null),
          priceUsd: toNumber(attributes.price_usd),
          volume24hUsd: toNumber(attributes.volume_usd?.h24),
          fdvUsd: toNumber(attributes.fdv_usd),
          marketCapUsd: toNumber(attributes.market_cap_usd),
          liquidityUsd: toNumber(attributes.total_reserve_in_usd),
        }
      }
    }
  } catch {
    // Unreachable upstream — the null entry below keeps the card identity-only for a minute
  }

  if (cache.size >= MAX_CACHE_ENTRIES) cache.clear()
  cache.set(key, { at: Date.now(), info })
  return info
}

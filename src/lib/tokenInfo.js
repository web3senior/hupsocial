// Best-effort token profile via GeckoTerminal's public single-token endpoint (no key),
// server-side only. Same contract as tokenLogos.js: this is reading material, so every
// failure path resolves to null and the UI renders identity-only instead of erroring.

import { GECKOTERMINAL_NETWORKS } from '@/lib/tokenLogos'

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
          name: attributes.name ?? null,
          symbol: attributes.symbol ?? null,
          decimals: toNumber(attributes.decimals),
          // GeckoTerminal returns the literal string "missing.png" for unbranded tokens
          logo: image && image !== 'missing.png' ? image : null,
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

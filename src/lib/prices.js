// Best-effort USD prices for revenue display, via DefiLlama's public coins API
// (no key). Server-side only. Prices are cosmetic — every failure path returns
// an empty result and the UI renders token amounts without USD.

const LLAMA_ENDPOINT = 'https://coins.llama.fi/prices/current/'
const LLAMA_PERCENTAGE_ENDPOINT = 'https://coins.llama.fi/percentage/'
const CACHE_TTL_MS = 5 * 60 * 1000
const FETCH_TIMEOUT_MS = 2500

const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000'

// chainId → DefiLlama chain slug for ERC20 lookups. Testnets are absent on
// purpose — their tokens have no market price.
const CHAIN_SLUGS = {
  1: 'ethereum',
  42: 'lukso',
  56: 'bsc',
  143: 'monad',
  8453: 'base',
  42161: 'arbitrum',
  42220: 'celo',
}

// chainId → coingecko id for the native gas token.
const NATIVE_KEYS = {
  1: 'coingecko:ethereum',
  42: 'coingecko:lukso-token-2',
  56: 'coingecko:binancecoin',
  143: 'coingecko:monad',
  4663: 'coingecko:ethereum',
  8453: 'coingecko:ethereum',
  42161: 'coingecko:ethereum',
  42220: 'coingecko:celo',
}

let cache = { at: 0, prices: new Map() }
let changeCache = { at: 0, changes: new Map() }

/** DefiLlama key for a (chainId, token address) pair, or null when unpriceable. */
export function priceKeyFor(networkId, token) {
  if (token === NATIVE_TOKEN) return NATIVE_KEYS[networkId] || null
  const slug = CHAIN_SLUGS[networkId]
  return slug ? `${slug}:${token}` : null
}

/**
 * Resolve USD prices for a set of DefiLlama keys. Returns Map<key, price>.
 * Cached for 5 minutes; missing keys are simply absent from the result.
 */
export async function fetchUsdPrices(keys) {
  const wanted = [...new Set(keys.filter(Boolean))]
  if (wanted.length === 0) return new Map()

  const fresh = Date.now() - cache.at < CACHE_TTL_MS
  const missing = fresh ? wanted.filter((key) => !cache.prices.has(key)) : wanted

  if (missing.length > 0) {
    try {
      const response = await fetch(`${LLAMA_ENDPOINT}${missing.join(',')}`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (response.ok) {
        const { coins } = await response.json()
        if (!fresh) cache = { at: Date.now(), prices: new Map() }
        for (const [key, coin] of Object.entries(coins || {})) {
          if (typeof coin?.price === 'number') cache.prices.set(key, coin.price)
        }
        cache.at = Date.now()
      }
    } catch (e) {
      // Network hiccup or timeout — serve whatever the cache has.
    }
  }

  return new Map(wanted.filter((key) => cache.prices.has(key)).map((key) => [key, cache.prices.get(key)]))
}

/**
 * 24h price movement for a set of DefiLlama keys, as a signed percentage (-0.37 means -0.37%).
 * Returns Map<key, percent>. Same best-effort contract as fetchUsdPrices — a failure just means
 * the caller renders no change badge.
 */
export async function fetchUsdChange24h(keys) {
  const wanted = [...new Set(keys.filter(Boolean))]
  if (wanted.length === 0) return new Map()

  const fresh = Date.now() - changeCache.at < CACHE_TTL_MS
  const missing = fresh ? wanted.filter((key) => !changeCache.changes.has(key)) : wanted

  if (missing.length > 0) {
    try {
      const response = await fetch(`${LLAMA_PERCENTAGE_ENDPOINT}${missing.join(',')}?period=24h`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (response.ok) {
        const { coins } = await response.json()
        if (!fresh) changeCache = { at: Date.now(), changes: new Map() }
        for (const [key, percent] of Object.entries(coins || {})) {
          if (typeof percent === 'number') changeCache.changes.set(key, percent)
        }
        changeCache.at = Date.now()
      }
    } catch (e) {
      // Network hiccup or timeout — serve whatever the cache has.
    }
  }

  return new Map(wanted.filter((key) => changeCache.changes.has(key)).map((key) => [key, changeCache.changes.get(key)]))
}

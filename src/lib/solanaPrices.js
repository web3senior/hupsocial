/**
 * @file lib/solanaPrices.js
 * @description Best-effort market data for the curated Solana mints, server-side only.
 *
 * Same contract as prices.js and tokenLogos.js: every failure path yields an absent entry
 * rather than an error, and the cashtag card degrades to identity-only.
 *
 * Two public keyless upstreams, merged rather than chosen between, because neither is
 * complete on its own:
 *   - Jupiter answers a whole batch in one request and is the only source for holder count —
 *     the most telling number on a small-cap card. It indexes far more mints than it routes,
 *     so it often knows a token's holders and branding while reporting no price at all.
 *   - DexScreener prices what Jupiter will not route, one mint per request. It returns every
 *     pool, so the deepest wins: a token's dust pools quote wildly off-market and would
 *     otherwise decide the price shown.
 *
 * The split is decided per response, not per config entry, so the day Jupiter starts routing
 * a token — or stops — this corrects itself without an edit.
 */

import { SOLANA_TOKENS, solanaTokenFor } from '@/config/solanaTokens'

const JUPITER_ENDPOINT = 'https://lite-api.jup.ag/tokens/v2/search?query='
const DEXSCREENER_ENDPOINT = 'https://api.dexscreener.com/latest/dex/tokens/'

// A hover card is meant to read live, so this is far shorter than the 5min prices.js uses for
// revenue figures — but still long enough that one busy thread is a single upstream call.
const CACHE_TTL_MS = 60 * 1000
const FETCH_TIMEOUT_MS = 4000

// Jupiter takes a comma-separated query; keep batches modest so one bad mint can't fail many
const MAX_PER_REQUEST = 20

let cache = { at: 0, entries: new Map() }

const num = (value) => {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
}

const chunk = (items, size) => {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Read a batch from Jupiter. Returns Map<mint, partial entry> — `usd` is null for the many
 * mints Jupiter indexes but does not route, and the caller prices those elsewhere.
 */
async function fetchFromJupiter(mints) {
  const found = new Map()

  for (const batch of chunk(mints, MAX_PER_REQUEST)) {
    try {
      const response = await fetch(`${JUPITER_ENDPOINT}${batch.join(',')}`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!response.ok) continue

      const body = await response.json()
      if (!Array.isArray(body)) continue

      for (const token of body) {
        // The search endpoint answers fuzzy matches too — keep only the mints actually asked
        // for, or a lookalike further down the list overwrites the real token
        if (!batch.includes(token?.id)) continue

        found.set(token.id, {
          usd: num(token.usdPrice),
          change24h: num(token.stats24h?.priceChange),
          mcap: num(token.mcap),
          liquidity: num(token.liquidity),
          holders: num(token.holderCount),
          logo: token.icon || null,
        })
      }
    } catch (e) {
      // Network hiccup or timeout — this batch stays absent and the cache serves what it has
    }
  }

  return found
}

/** Price one mint from its deepest Solana pool. Returns a partial entry, or null when unlisted. */
async function fetchFromDexScreener(mint) {
  try {
    const response = await fetch(`${DEXSCREENER_ENDPOINT}${mint}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok) return null

    const { pairs } = await response.json()
    if (!Array.isArray(pairs)) return null

    // Deepest pool only. TBULL, for one, has a ~$65k Meteora pool alongside pools holding $6
    // and $308 — the shallow ones quote a price no one could actually trade at.
    const best = pairs
      .filter((pair) => pair?.chainId === 'solana' && pair?.baseToken?.address === mint)
      .sort((a, b) => (num(b?.liquidity?.usd) ?? 0) - (num(a?.liquidity?.usd) ?? 0))[0]
    if (!best) return null

    return {
      usd: num(best.priceUsd),
      change24h: num(best.priceChange?.h24),
      // marketCap is absent on tokens DexScreener has no circulating figure for
      mcap: num(best.marketCap ?? best.fdv),
      liquidity: num(best.liquidity?.usd),
      logo: best.info?.imageUrl || null,
    }
  } catch (e) {
    return null
  }
}

/** Later source wins per field, but only where it actually has a number. */
const merge = (base, extra) => {
  const out = { usd: null, change24h: null, mcap: null, liquidity: null, holders: null, logo: null, ...base }
  for (const [key, value] of Object.entries(extra || {})) {
    if (value !== null && value !== undefined) out[key] = value
  }
  return out
}

/**
 * Market data for a set of allowlisted cashtag symbols.
 * @param {string[]} symbols
 * @returns {Promise<Record<string, object>>} keyed by uppercase symbol; absent when unpriceable
 */
export async function fetchSolanaMarket(symbols) {
  const wanted = new Map()
  for (const symbol of symbols) {
    const key = String(symbol || '').toUpperCase()
    const token = solanaTokenFor(key)
    // Unlisted symbols drop out here — this is the check that keeps a spoofed mint from ever
    // reaching an upstream, however the symbol arrived
    if (token) wanted.set(key, token)
  }
  if (wanted.size === 0) return {}

  const fresh = Date.now() - cache.at < CACHE_TTL_MS
  if (!fresh) cache = { at: Date.now(), entries: new Map() }

  const stale = [...wanted.values()].filter((token) => !cache.entries.has(token.mint))

  if (stale.length > 0) {
    const jupiter = await fetchFromJupiter(stale.map((token) => token.mint))

    // Anything Jupiter could not price — plus anything pinned to DexScreener in config — gets
    // a second look. Jupiter's holder count and branding still stand for those mints.
    const unpriced = stale.filter(
      (token) => token.source === 'dexscreener' || num(jupiter.get(token.mint)?.usd) === null,
    )
    const dexscreener = await Promise.all(
      unpriced.map((token) => fetchFromDexScreener(token.mint).then((data) => [token.mint, data])),
    )
    const priced = new Map(dexscreener.filter(([, data]) => data))

    for (const token of stale) {
      const combined = merge(jupiter.get(token.mint), priced.get(token.mint))
      // No price from either upstream means there is nothing worth showing
      if (combined.usd === null) continue
      cache.entries.set(token.mint, combined)
    }
    cache.at = Date.now()
  }

  const out = {}
  for (const [symbol, token] of wanted) {
    const data = cache.entries.get(token.mint)
    if (!data) continue
    out[symbol] = { ...data, mint: token.mint, symbol, name: token.name, decimals: token.decimals }
  }
  return out
}

/** Every allowlisted symbol at once — the warm path for a feed full of cashtags. */
export const fetchAllSolanaMarket = () => fetchSolanaMarket(Object.keys(SOLANA_TOKENS))

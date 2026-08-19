/**
 * @file lib/priceHistory.js
 * @description Price history for cashtag cards, server-side only. Same best-effort contract as
 * prices.js: a miss yields an absent entry and the card renders its quote without a chart.
 *
 * DefiLlama's chart API answers every range for most tokens and batches many coins per
 * request, so a post citing several cashtags costs one call. Tokens it indexes too thinly to
 * chart (see `source: 'dex'` in config/cashtags) fall back to their deepest GeckoTerminal pool,
 * one request each.
 *
 * Ranges are clamped by what actually exists: a token that launched eight weeks ago returns
 * the same eight weeks for 1Y and ALL, so `coverageDays` is reported and the selector hides
 * the ranges it cannot honestly fill.
 */

import { cashtagFor, splitKey } from '@/config/cashtags'

const LLAMA_CHART = 'https://coins.llama.fi/chart/'
const GECKOTERMINAL = 'https://api.geckoterminal.com/api/v2/networks'

const FETCH_TIMEOUT_MS = 6000

/**
 * Span/period per range, and how long a cached answer stays usable. A 1D line is the one
 * people watch tick; a multi-year line does not meaningfully move within the hour.
 */
export const RANGES = {
  '1D': { span: 48, period: '30m', ttlMs: 2 * 60 * 1000, gecko: { tf: 'hour', aggregate: 1, limit: 24 } },
  '1W': { span: 56, period: '3h', ttlMs: 10 * 60 * 1000, gecko: { tf: 'hour', aggregate: 4, limit: 42 } },
  '1M': { span: 30, period: '1d', ttlMs: 30 * 60 * 1000, gecko: { tf: 'day', aggregate: 1, limit: 30 } },
  '1Y': { span: 52, period: '1w', ttlMs: 60 * 60 * 1000, gecko: { tf: 'day', aggregate: 7, limit: 52 } },
  ALL: { span: 200, period: '1w', ttlMs: 60 * 60 * 1000, gecko: { tf: 'day', aggregate: 7, limit: 200 } },
}

export const DEFAULT_RANGE = '1D'

// The compact card's inline sparkline is always a week — it carries no range selector
export const SPARKLINE_RANGE = '1W'

// cacheKey -> { at, series }, where a null series is a remembered miss. Caching misses is
// not an optimisation here but a correctness fix: several listed tokens have no data at some
// ranges at all (LUKSO carries no intraday history whatsoever), and without this every render
// re-asked upstream for something that will never exist — which is what got these requests
// rate-limited into returning nothing during testing.
const cache = new Map()

// A miss is re-checked sooner than a hit is refreshed: coverage does appear over time, as a
// young token accumulates the history a longer range needs.
const MISS_TTL_MS = 5 * 60 * 1000

const num = (value) => {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
}

/**
 * Fold a point list into what a card actually draws: the series plus the change measured from
 * the period's own open, which is the number the dashed baseline represents.
 */
const series = (points) => {
  const clean = points
    .map((p) => ({ t: num(p.t), p: num(p.p) }))
    .filter((p) => p.t !== null && p.p !== null && p.p > 0)
    .sort((a, b) => a.t - b.t)
  if (clean.length < 2) return null

  const open = clean[0].p
  const close = clean[clean.length - 1].p
  return {
    points: clean,
    open,
    close,
    changeAbs: close - open,
    changePct: ((close - open) / open) * 100,
    // What the range actually covered, so the selector can drop ranges this token cannot fill
    coverageDays: (clean[clean.length - 1].t - clean[0].t) / 86400,
  }
}

/**
 * Batch-read ranges from DefiLlama.
 * @returns {Promise<{ok: boolean, found: Map<string, object>}>} `ok` says the request itself
 * succeeded — which is what separates "this coin has no data at this range" from "the request
 * failed". Only the former may be remembered as a miss; caching a rate-limited response would
 * blank a perfectly chartable token for the life of the entry.
 */
async function fetchFromLlama(keys, range) {
  const { span, period } = RANGES[range]
  const found = new Map()
  try {
    const response = await fetch(`${LLAMA_CHART}${keys.join(',')}?span=${span}&period=${period}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok) return { ok: false, found }

    const { coins = {} } = await response.json()
    for (const [key, coin] of Object.entries(coins)) {
      // Only the keys asked for — the endpoint can echo a normalized alias
      if (!keys.includes(key)) continue
      const built = series((coin.prices || []).map((p) => ({ t: p.timestamp, p: p.price })))
      if (built) found.set(key, built)
    }
    return { ok: true, found }
  } catch (e) {
    // Timeout or network hiccup — the cards render quote-only, and nothing is remembered
    return { ok: false, found }
  }
}

/** Deepest Solana pool for a mint, or null. Cached alongside the series it feeds. */
async function topPoolFor(mint) {
  const cached = cache.get(`pool:${mint}`)
  // Pools do not change often; an hour is plenty
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached.series

  try {
    const response = await fetch(`${GECKOTERMINAL}/solana/tokens/${mint}/pools?page=1`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok) return null
    const { data = [] } = await response.json()
    const best = data
      .map((pool) => ({ address: pool?.attributes?.address, liq: num(pool?.attributes?.reserve_in_usd) ?? 0 }))
      .filter((pool) => pool.address)
      .sort((a, b) => b.liq - a.liq)[0]
    const address = best?.address ?? null
    cache.set(`pool:${mint}`, { at: Date.now(), series: address })
    return address
  } catch (e) {
    return null
  }
}

/** Read one thin-liquidity mint from its deepest pool's OHLCV. Same ok/series split as above. */
async function fetchFromGecko(mint, range) {
  const pool = await topPoolFor(mint)
  if (!pool) return { ok: false, series: null }

  const { tf, aggregate, limit } = RANGES[range].gecko
  try {
    const response = await fetch(
      `${GECKOTERMINAL}/solana/pools/${pool}/ohlcv/${tf}?aggregate=${aggregate}&limit=${limit}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    )
    if (!response.ok) return { ok: false, series: null }
    const list = (await response.json())?.data?.attributes?.ohlcv_list || []
    // GeckoTerminal returns [timestamp, o, h, l, c, volume], newest first
    return { ok: true, series: series(list.map((candle) => ({ t: candle[0], p: candle[4] }))) }
  } catch (e) {
    return { ok: false, series: null }
  }
}

/**
 * History for a set of cashtag symbols at one range.
 * @param {string[]} symbols
 * @param {string} range one of RANGES
 * @returns {Promise<Record<string, object>>} keyed by uppercase symbol; absent when unchartable
 */
export async function fetchPriceHistory(symbols, range = DEFAULT_RANGE) {
  if (!RANGES[range]) range = DEFAULT_RANGE
  const { ttlMs } = RANGES[range]

  const wanted = new Map()
  for (const symbol of symbols) {
    const key = String(symbol || '').toUpperCase()
    const entry = cashtagFor(key)
    // Unlisted symbols drop out here, so no caller can chart an arbitrary address
    if (entry) wanted.set(key, entry)
  }
  if (wanted.size === 0) return {}

  const fresh = (cacheKey) => {
    const hit = cache.get(cacheKey)
    if (!hit) return undefined
    const age = Date.now() - hit.at
    if (hit.series === null) return age < MISS_TTL_MS ? null : undefined
    return age < ttlMs ? hit.series : undefined
  }

  const stale = [...wanted.entries()].filter(([, entry]) => fresh(`${entry.key}:${range}`) === undefined)

  if (stale.length > 0) {
    const viaLlama = stale.filter(([, entry]) => entry.source !== 'dex').map(([, entry]) => entry.key)
    const viaGecko = stale.filter(([, entry]) => entry.source === 'dex')

    const [llama, gecko] = await Promise.all([
      viaLlama.length ? fetchFromLlama(viaLlama, range) : { ok: true, found: new Map() },
      Promise.all(
        viaGecko.map(([, entry]) =>
          fetchFromGecko(splitKey(entry.key).address, range).then((result) => [entry.key, result]),
        ),
      ),
    ])

    // Every key that was asked for gets an entry — a series when one came back, null when
    // nothing did, so the next caller does not repeat a request already known to be fruitless
    if (llama.ok) {
      for (const key of viaLlama) cache.set(`${key}:${range}`, { at: Date.now(), series: llama.found.get(key) ?? null })
    } else {
      for (const [key, data] of llama.found) cache.set(`${key}:${range}`, { at: Date.now(), series: data })
    }
    for (const [key, result] of gecko) {
      if (result.ok || result.series) cache.set(`${key}:${range}`, { at: Date.now(), series: result.series })
    }
  }

  const out = {}
  for (const [symbol, entry] of wanted) {
    const data = cache.get(`${entry.key}:${range}`)?.series
    if (data) out[symbol] = { ...data, range }
    // A null series is a known gap, not a failure — the card renders its quote without a chart
  }
  return out
}

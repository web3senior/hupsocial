// Tokenized equities offered as Hup Launch quote assets, read from the issuer's live registry.
//
// Server-side only. Unlike the curated rows in lib/tokens.js this list is hundreds of names deep
// and changes as the issuer lists and delists, so it is fetched rather than committed — a
// hardcoded copy would be wrong within a week and there is no way to notice from inside the repo.
//
// Only NON-REBASING equity tokens belong here. Robinhood's stock tokens keep `balanceOf` fixed
// and expose corporate actions through `uiMultiplier()`, which is what makes them safe to lock
// inside a Uniswap position forever. Backed's xStocks apply their multiplier inside `balanceOf`,
// so a dividend or a reverse split silently moves the balance a pool is holding — that breaks
// v4's accounting with no way to rebalance a locked position, and they are deliberately absent.

import { resolveQuoteAsset } from '@/lib/launchQuote'

const CACHE_TTL_MS = 30 * 60 * 1000
const FETCH_TIMEOUT_MS = 4000

/**
 * Per-chain registries. `parse` returns rows in this module's own shape, so a second issuer on a
 * second chain is a parser rather than a change to anything that reads this.
 */
const REGISTRIES = {
  4663: {
    url: 'https://api.robinhood.com/rhj/assets',
    parse: (payload, networkId) =>
      (payload?.assets ?? [])
        .filter((asset) => asset?.status === 'ASSET_STATUS_ACTIVE')
        .flatMap((asset) => {
          const deployment = (asset.deployments ?? []).find((entry) => entry.chainId === networkId)
          if (!deployment?.contractAddress) return []

          return [
            {
              address: deployment.contractAddress,
              symbol: asset.tokenSymbol,
              // "NVIDIA • Robinhood Token" is the issuer's framing, not the company's name
              name: String(asset.tokenName ?? '').split('•')[0].trim() || asset.tokenSymbol,
              decimals: Number(asset.tokenDecimals ?? 18),
              logo: asset.logoUrl ?? null,
              kind: 'stock',
            },
          ]
        }),
  },
}

const cache = new Map()

/** True when this chain has an equity registry at all, so callers can skip the round trip. */
export const hasStockRegistry = (networkId) => Boolean(REGISTRIES[Number(networkId)])

/**
 * Every equity token listed on a chain, keyed by lowercased address.
 *
 * Failure is not an error state: the picker falls back to the curated assets and a launch already
 * quoted in a stock keeps rendering off its onchain reads. So a dead registry costs a ticker, not
 * a page. The stale copy is preferred over nothing when a refresh fails.
 *
 * @param {number|string} networkId
 * @returns {Promise<Map<string, {address: string, symbol: string, name: string, decimals: number,
 *   logo: string|null, kind: string}>>}
 */
export async function getStockTokens(networkId) {
  const chainId = Number(networkId)
  const registry = REGISTRIES[chainId]
  if (!registry) return new Map()

  const cached = cache.get(chainId)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.tokens

  try {
    const response = await fetch(registry.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`registry ${response.status}`)

    const rows = registry.parse(await response.json(), chainId)
    const tokens = new Map(rows.map((row) => [row.address.toLowerCase(), row]))

    cache.set(chainId, { at: Date.now(), tokens })
    return tokens
  } catch (error) {
    console.error(`[STOCK_REGISTRY_ERROR] chain ${chainId}:`, error.message)
    return cached?.tokens ?? new Map()
  }
}

/** One equity token, or null when the chain has no registry or does not list it. */
export async function stockTokenFor(networkId, address) {
  if (!address) return null
  const tokens = await getStockTokens(networkId)
  return tokens.get(String(address).toLowerCase()) ?? null
}

/**
 * Stamps `quote_symbol` and `quote_decimals` onto indexed launch rows.
 *
 * Config answers for native and the curated stablecoins without leaving the process; only a quote
 * the build does not know about reaches the registry, and then once per chain for the whole page
 * rather than once per row. A page of launches spanning several chains costs at most one fetch
 * each, and none at all when nothing on it is quoted in an equity.
 *
 * @param {Array<{network_id: number, quote: string}>} rows Mutated in place.
 */
export async function attachQuoteAssets(rows) {
  const unresolved = []

  for (const row of rows) {
    const quote = resolveQuoteAsset(row.network_id, row.quote)
    row.quote_symbol = quote.symbol
    row.quote_decimals = quote.decimals

    if (!quote.isNative && !quote.isCurated && hasStockRegistry(row.network_id)) unresolved.push(row)
  }

  if (unresolved.length === 0) return rows

  const chains = [...new Set(unresolved.map((row) => Number(row.network_id)))]
  const registries = new Map(
    await Promise.all(chains.map(async (chainId) => [chainId, await getStockTokens(chainId)])),
  )

  for (const row of unresolved) {
    const listed = registries.get(Number(row.network_id))?.get(String(row.quote).toLowerCase())
    if (!listed) continue

    row.quote_symbol = listed.symbol
    row.quote_decimals = listed.decimals
  }

  return rows
}

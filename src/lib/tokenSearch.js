'use client'

// Token-by-name search for the TipModal's custom-token picker. LUKSO chains query the
// Envio indexer's Asset table directly (same source Profile/Universal Profile lookups use
// elsewhere in the app) — that's where LSP7 metadata actually lives, not onchain symbol().
// Every other chain queries GeckoTerminal's pool search and dedupes the paired tokens out
// of the results (no LUKSO coverage there is deep enough for small LSP7s, but its DEX-pool
// index covers the major EVM chains well). Chains neither source covers return no results —
// callers keep the manual paste-an-address field as the fallback.

const LUKSO_CHAIN_IDS = [42]

// GeckoTerminal network slugs for the chains Hup runs on that it actually indexes.
// Monad and Robinhood aren't covered (too new/niche) — searchTokens returns [] for them.
const GECKOTERMINAL_NETWORKS = {
  1: 'eth',
  56: 'bsc',
  8453: 'base',
  42161: 'arbitrum',
  42220: 'celo',
}

const MAX_RESULTS = 8

async function searchLuksoTokens(query) {
  const endpoint = process.env.NEXT_PUBLIC_LUKSO_API_ENDPOINT
  if (!endpoint) return []

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      query: `query SearchLSP7($q: String!) {
        Asset(
          where: {lsp4TokenName: {_ilike: $q}, isLSP7: {_eq: true}}
          limit: ${MAX_RESULTS}
          order_by: {holders_aggregate: {count: desc}}
        ) {
          id
          lsp4TokenSymbol
          lsp4TokenName
          holders_aggregate {
            aggregate {
              count
            }
          }
        }
      }`,
      variables: { q: `%${query}%` },
    }),
  })
  if (!response.ok) return []

  const body = await response.json()
  return (body?.data?.Asset || [])
    .filter((asset) => asset?.id)
    .map((asset) => ({
      address: asset.id,
      symbol: asset.lsp4TokenSymbol || 'tokens',
      name: asset.lsp4TokenName || null,
      isLsp7: true,
      holderCount: asset.holders_aggregate?.aggregate?.count ?? null,
      liquidityUsd: null,
    }))
}

async function searchGeckoTerminalTokens(chainId, query) {
  const network = GECKOTERMINAL_NETWORKS[chainId]
  if (!network) return []

  const url = `https://api.geckoterminal.com/api/v2/search/pools?query=${encodeURIComponent(query)}&network=${network}&include=base_token,quote_token`
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) return []

  const body = await response.json()
  const lowerQuery = query.toLowerCase()

  // Sum each token's pooled liquidity across the returned pools — same-name copycat tokens
  // have near-zero liquidity, so this is the ranking signal that floats the real one up.
  const liquidityByTokenId = new Map()
  for (const pool of body?.data || []) {
    const reserve = Number(pool?.attributes?.reserve_in_usd) || 0
    for (const side of ['base_token', 'quote_token']) {
      const tokenId = pool?.relationships?.[side]?.data?.id
      if (tokenId) liquidityByTokenId.set(tokenId, (liquidityByTokenId.get(tokenId) || 0) + reserve)
    }
  }

  // Pool search matches on pool name (e.g. "USDC / WETH 0.05%"), which pulls in the paired
  // token too — re-filter the included tokens against the query so an "ETH" search doesn't
  // surface every token that's ever been paired against WETH.
  const seen = new Map()
  for (const item of body?.included || []) {
    if (item.type !== 'token') continue
    const { address, symbol, name } = item.attributes || {}
    if (!address || !symbol) continue
    if (!symbol.toLowerCase().includes(lowerQuery) && !(name || '').toLowerCase().includes(lowerQuery)) continue

    const key = address.toLowerCase()
    if (!seen.has(key)) {
      seen.set(key, {
        address,
        symbol,
        name: name || null,
        isLsp7: false,
        holderCount: null,
        liquidityUsd: liquidityByTokenId.get(item.id) || 0,
      })
    }
  }

  return [...seen.values()].sort((a, b) => b.liquidityUsd - a.liquidityUsd).slice(0, MAX_RESULTS)
}

const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

/**
 * Popularity line for a search result — the signal that separates the real token from
 * same-name copycats (LUKSO returns holder counts, GeckoTerminal pool liquidity). Lives here
 * rather than in each caller because it formats this module's own result shape.
 * @param {{holderCount: number|null, liquidityUsd: number|null}} result
 * @returns {string|null} Null when neither source reported anything to show.
 */
export const formatTokenPopularity = (result) => {
  if (result.holderCount !== null && result.holderCount !== undefined) {
    return `${compactNumber.format(result.holderCount)} ${result.holderCount === 1 ? 'holder' : 'holders'}`
  }
  if (result.liquidityUsd) return `$${compactNumber.format(result.liquidityUsd)} liquidity`
  return null
}

/**
 * Searches known tokens by name/symbol on a chain, most-held/most-liquid first. Returns []
 * on unsupported chains, network failure, or a too-short query — callers keep a manual
 * address field as fallback. holderCount is LUKSO-only; liquidityUsd is GeckoTerminal-only.
 * @param {number} chainId
 * @param {string} query
 * @returns {Promise<Array<{address: string, symbol: string, name: string|null, isLsp7: boolean, holderCount: number|null, liquidityUsd: number|null}>>}
 */
export async function searchTokens(chainId, query) {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  try {
    return LUKSO_CHAIN_IDS.includes(chainId) ? await searchLuksoTokens(trimmed) : await searchGeckoTerminalTokens(chainId, trimmed)
  } catch {
    return []
  }
}

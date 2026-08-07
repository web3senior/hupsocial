'use client'

// USD price, 24h movement and logo for a set of held tokens, from /api/v1/tokens/market.
// Purely cosmetic: while this is loading — or if it never resolves — the Assets tab still
// renders every balance, just without the fiat column.

import useSWR from 'swr'

const ENDPOINT = '/api/v1/tokens/market'
const EMPTY = {}

const fetchMarket = async (tokens) => {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tokens }),
  })
  if (!response.ok) return EMPTY
  const body = await response.json()
  return body?.data ?? EMPTY
}

/**
 * @param {Array<{id: string, chainId: number, address: string|null}>} assets
 * @returns {{market: Record<string, {usd: number|null, change24h: number|null, logo: string|null}>}}
 */
export function useTokenMarket(assets) {
  // Key on the holdings themselves, so the prices refetch when a new token appears but not on
  // every balance tick
  const key = assets.length ? ['token-market', assets.map((asset) => asset.id).sort().join(',')] : null

  const { data } = useSWR(key, () => fetchMarket(assets.map(({ chainId, address }) => ({ chainId, address }))), {
    revalidateOnFocus: false,
    // Prices go stale faster than balances, but this is a background nicety — don't hammer it
    refreshInterval: 120_000,
    keepPreviousData: true,
  })

  return { market: data ?? EMPTY }
}

export default useTokenMarket

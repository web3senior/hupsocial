'use client'

// USD price of one chain's native coin, from /api/v1/tokens/market — the same keyless,
// best-effort upstream the Assets tab uses. Purely cosmetic: while this is loading, or on a
// chain with no market price at all, the caller shows the coin amount alone.

import useSWR from 'swr'

const ENDPOINT = '/api/v1/tokens/market'

const fetchNativePrice = async (chainId) => {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tokens: [{ chainId, address: null }] }),
  })
  if (!response.ok) return null
  const body = await response.json()
  return body?.data?.[`${chainId}:native`]?.usd ?? null
}

/**
 * @param {number|null|undefined} chainId
 * @returns {number|null} Dollars per whole coin, or null when the chain has no market price.
 */
export function useNativePrice(chainId) {
  const { data } = useSWR(chainId ? ['native-price', chainId] : null, () => fetchNativePrice(Number(chainId)), {
    revalidateOnFocus: false,
    refreshInterval: 120_000,
    keepPreviousData: true,
  })

  return data ?? null
}

export default useNativePrice

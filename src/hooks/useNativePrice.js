'use client'

// USD price of one chain's native coin or token, from /api/v1/tokens/market — the same keyless,
// best-effort upstream the Assets tab uses. Purely cosmetic: while this is loading, or on a
// chain with no market price at all, the caller shows the coin amount alone.

import useSWR from 'swr'

const ENDPOINT = '/api/v1/tokens/market'

const fetchPrice = async (chainId, address) => {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tokens: [{ chainId, address: address ?? null }] }),
  })
  if (!response.ok) return null
  const body = await response.json()
  return body?.data?.[`${chainId}:${address ? address.toLowerCase() : 'native'}`]?.usd ?? null
}

/**
 * @param {number|null|undefined} chainId
 * @param {string|null} [address] Token contract, or null for the native coin.
 * @returns {{ price: number|null, isLoading: boolean }} Dollars per whole unit, or null when
 * the token has no market price.
 */
export function useTokenPrice(chainId, address = null) {
  const { data, isLoading } = useSWR(
    chainId ? ['token-price', Number(chainId), address?.toLowerCase() ?? null] : null,
    () => fetchPrice(Number(chainId), address),
    { revalidateOnFocus: false, refreshInterval: 120_000 }
  )

  return { price: data ?? null, isLoading: Boolean(chainId) && isLoading }
}

/**
 * @param {number|null|undefined} chainId
 * @returns {number|null} Dollars per whole coin, or null when the chain has no market price.
 */
export function useNativePrice(chainId) {
  return useTokenPrice(chainId).price
}

export default useNativePrice

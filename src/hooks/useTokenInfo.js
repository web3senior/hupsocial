'use client'

// GeckoTerminal profile for one token, from /api/v1/tokens/info. Reading material for the
// swap page's info card: while this loads — or if the token has no listing — the card still
// shows identity and the copyable contract address. No keepPreviousData: a token switch must
// never show the previous token's numbers under the new token's name.

import useSWR from 'swr'

const fetcher = (url) => fetch(url).then((res) => (res.ok ? res.json() : null))

/**
 * @param {number|null} chainId
 * @param {string|null} address Contract address, or null to skip the lookup entirely.
 * @returns {{info: {name: string|null, symbol: string|null, decimals: number|null,
 *   logo: string|null, priceUsd: number|null, volume24hUsd: number|null, fdvUsd: number|null,
 *   marketCapUsd: number|null, liquidityUsd: number|null}|null, isLoading: boolean}}
 */
export function useTokenInfo(chainId, address) {
  const key = chainId && address ? `/api/v1/tokens/info?networkId=${chainId}&address=${address.toLowerCase()}` : null
  const { data, isLoading } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 60_000,
  })

  return { info: data?.data ?? null, isLoading }
}

export default useTokenInfo

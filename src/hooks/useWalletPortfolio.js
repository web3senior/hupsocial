'use client'

// The portfolio summary behind a profile card, from /api/v1/users/[address]/portfolio.
//
// Cosmetic and deliberately quiet: one request per wallet, no refetch on focus, and a long
// dedupe window so re-hovering the same avatar — or hovering the same author twice in a feed —
// costs nothing. The route caches server-side too; this only keeps the browser from asking.

import useSWR from 'swr'

// Matches the snapshot the route holds, so a second ask inside the window would be answered
// with the same figures anyway
const DEDUPE_MS = 120_000

const fetchPortfolio = async ([, address, network]) => {
  const query = network ? `?network=${encodeURIComponent(network)}` : ''
  const response = await fetch(`/api/v1/users/${address}/portfolio${query}`)
  if (!response.ok) return null
  const body = await response.json()
  return body?.data ?? null
}

/**
 * @param {string|null} address Wallet whose holdings to summarise.
 * @param {number|string|null} networkId Chain whose native coin is headlined.
 * @returns {{portfolio: Object|null, isLoading: boolean}}
 */
export function useWalletPortfolio(address, networkId = null) {
  const { data, isLoading } = useSWR(address ? ['wallet-portfolio', address, networkId ?? ''] : null, fetchPortfolio, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    dedupingInterval: DEDUPE_MS,
    keepPreviousData: true,
  })

  return { portfolio: data ?? null, isLoading: isLoading && Boolean(address) }
}

export default useWalletPortfolio

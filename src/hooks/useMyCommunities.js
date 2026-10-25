'use client'

import useSWR from 'swr'
import { CONTRACTS, config } from '@/config/wagmi'
import { canPostInCommunity } from '@/lib/communityPosting'

const fetcher = (url) => fetch(url).then((res) => res.json())

// The directory's own page ceiling. Nobody picks from a longer list in a composer.
const LIMIT = 50

/**
 * The communities a wallet can post into, across every network with a community contract — the
 * list the composer's "Community" picker offers. Narrowed server-side to the communities the
 * wallet belongs to (member_address), then to the ones canPost() would let it write in.
 * @param {string|null} address The connected wallet; null asks nothing.
 * @returns {{ communities: Array<object>, isLoading: boolean }}
 */
export default function useMyCommunities(address) {
  // Each network pinned to its current contract, so rows from retired deployments stay out
  const contracts = config.chains
    .filter((chain) => CONTRACTS[`chain${chain.id}`]?.community)
    .map((chain) => `${chain.id}:${CONTRACTS[`chain${chain.id}`].community}`)
    .join(',')

  const key =
    address && contracts
      ? `/api/v1/networks/communities?${new URLSearchParams({ contracts, member_address: address, viewer_address: address, limit: String(LIMIT) })}`
      : null

  const { data, isLoading } = useSWR(key, fetcher, { revalidateOnFocus: false })

  const communities = Array.isArray(data?.data) ? data.data.filter((row) => canPostInCommunity(row, address)) : []
  return { communities, isLoading }
}

'use client'

import useSWR from 'swr'
import { getNftCollectionTraits } from '@/lib/api'

/**
 * Trait facets for one collection's listed tokens, for the collection page's attribute filter.
 *
 * Deliberately a revalidating useSWR rather than the immutable variant every other collection
 * hook uses: the facet list is built from cached token metadata, and that cache fills in as the
 * page's own tiles resolve — an immutable fetch would leave the panel showing whatever was known
 * at mount and never learn the rest of the collection's traits.
 * @param {Object} params
 * @param {number|string} params.chainId Chain the collection lives on.
 * @param {string} params.collection NFT contract address.
 * @param {'active'|'sold'|'cancelled'|'active_sold'|'all'} [params.status='active'] Listing
 * status the grid is showing — the counts describe that same set.
 * @param {boolean} [params.enabled=true] Skip fetching while inputs are incomplete.
 * @returns {{traits: Array<{label: string, values: Array<{value: string, count: number}>}>,
 * listed: number|null, resolved: number|null, truncated: boolean, isLoading: boolean, error: any}}
 */
export default function useCollectionTraits({ chainId, collection, status = 'active', enabled = true }) {
  const ready = Boolean(enabled && chainId && collection)

  const { data, error, isLoading } = useSWR(
    ready ? ['nft-collection-traits', Number(chainId), collection.toLowerCase(), status] : null,
    () => getNftCollectionTraits(chainId, collection, status),
    { keepPreviousData: true },
  )

  return {
    traits: data?.data || [],
    // Tokens the current view can show, and how many of them have metadata cached. Equal
    // means the options below describe everything; short means they describe a subset.
    listed: data?.meta?.listed ?? null,
    resolved: data?.meta?.resolved ?? null,
    truncated: Boolean(data?.meta?.truncated),
    isLoading: ready && isLoading,
    error,
  }
}

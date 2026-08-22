'use client'

import { useMemo } from 'react'
import useSWR from 'swr'
import { getNftCollectionTraits } from '@/lib/api'

// A share computed over a thin metadata cache is sample noise, not rarity — the same floor
// useCollectionRarity applies to a computed ranking, for the same reason. Below this the trait
// cards print the count they actually counted instead of a percentage they can't stand behind.
const SHARE_COVERAGE_FLOOR = 0.5

// Tab-joined, matching the server's pair key. A tab survives neither side's trim, so
// "a<TAB>b" + "c" can never collide with "a" + "b<TAB>c".
const pairKey = (label, value) => `${label}\t${value}`

/**
 * Trait facets for one collection, for the collection page's attribute filter and the token
 * detail panel's trait cards.
 *
 * Deliberately a revalidating useSWR rather than the immutable variant every other collection
 * hook uses: the facet list is built from cached token metadata, and that cache fills in as the
 * page's own tiles resolve — an immutable fetch would leave the panel showing whatever was known
 * at mount and never learn the rest of the collection's traits.
 * @param {Object} params
 * @param {number|string} params.chainId Chain the collection lives on.
 * @param {string} params.collection NFT contract address.
 * @param {'active'|'sold'|'cancelled'|'active_sold'|'all'} [params.status='active'] Listing
 * status the grid is showing — the counts describe that same set. Ignored in collection scope.
 * @param {'listed'|'collection'} [params.scope='listed'] 'listed' counts only tokens the grid
 * can show, which is what a filter panel needs; 'collection' counts every cached token, the only
 * honest denominator for a rarity share.
 * @param {boolean} [params.floor=false] Ask for each value's lowest live ask, so a trait card
 * can price itself.
 * @param {number|string|null} [params.totalSupply] The collection's own supply, for judging
 * whether the scan covers enough of it to publish shares.
 * @param {boolean} [params.enabled=true] Skip fetching while inputs are incomplete.
 */
export default function useCollectionTraits({
  chainId,
  collection,
  status = 'active',
  scope = 'listed',
  floor = false,
  totalSupply,
  enabled = true,
}) {
  const ready = Boolean(enabled && chainId && collection)

  const { data, error, isLoading } = useSWR(
    ready ? ['nft-collection-traits', Number(chainId), collection.toLowerCase(), status, scope, floor] : null,
    () => getNftCollectionTraits(chainId, collection, status, { scope, floor }),
    { keepPreviousData: true },
  )

  const traits = data?.data
  const scanned = data?.meta?.scanned ?? null

  // Built once per response rather than per card — a token carrying eight traits would
  // otherwise walk every label's value list eight times
  const statsByPair = useMemo(() => {
    const pairs = new Map()

    for (const group of traits || []) {
      for (const entry of group.values) {
        pairs.set(pairKey(group.label, entry.value), {
          count: entry.count,
          // Of the tokens actually scanned, never of the collection's supply: a share has to be
          // consistent with the sample it came from, and `isShareTrustworthy` is what says
          // whether that sample is worth printing.
          share: scanned ? entry.count / scanned : null,
          floor: entry.floor ?? null,
        })
      }
    }

    return pairs
  }, [traits, scanned])

  const supply = Number(totalSupply) || 0
  const coverage = supply > 0 && scanned !== null ? scanned / supply : null

  return {
    traits: traits || [],
    // Tokens the current view can show, and how many of them have metadata cached. Equal
    // means the options below describe everything; short means they describe a subset.
    listed: data?.meta?.listed ?? null,
    resolved: data?.meta?.resolved ?? null,
    // How many tokens the counts were taken over — the denominator behind every share
    scanned,
    // {payment_token, symbol, decimals} the floors are quoted in, or null when none were asked
    // for or nothing in the collection is listed
    floorCurrency: data?.meta?.floor ?? null,
    // label + value → {count, share, floor}; the trait cards' lookup
    statsByPair,
    /** @param {string} label @param {string} value */
    statsFor: (label, value) => statsByPair.get(pairKey(label, value)) || null,
    truncated: Boolean(data?.meta?.truncated),
    // False while the cache holds too little of the collection for a percentage to mean
    // anything. With no supply to compare against there is nothing to doubt it with, so the
    // shares stand — the same benefit of the doubt useCollectionRarity gives a ranking.
    isShareTrustworthy: coverage === null || coverage >= SHARE_COVERAGE_FLOOR,
    coverage,
    isLoading: ready && isLoading,
    error,
  }
}

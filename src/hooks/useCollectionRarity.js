'use client'

import { useMemo } from 'react'
import useSWR from 'swr'
import { getNftCollectionRarity } from '@/lib/api'

// A computed ranking is only worth printing once it covers most of the collection. Below this
// the counts behind it are a sample of whatever happens to be cached, and the "rank" would
// move every time somebody browsed a new token — see the rarity route's header.
const COMPUTED_COVERAGE_FLOOR = 0.5

/**
 * Rarity ranks for one collection, as a lookup by token id.
 *
 * The whole ranking arrives in one request and is cached for the page's life: a rank only
 * means anything relative to every other token, so paging it would recompute the same scan
 * for every row the reader scrolls past.
 *
 * `isTrustworthy` is the flag the UI is expected to read before printing anything. Ranks the
 * collection publishes are trustworthy whatever the cache holds — they were computed over the
 * whole supply by whoever minted it. Ranks computed here are only trustworthy once enough of
 * the collection has resolved to make the trait counts mean something.
 * @param {Object} params
 * @param {number|string} params.chainId Chain the collection lives on.
 * @param {string} params.collection NFT contract address.
 * @param {number|string|null} [params.totalSupply] The collection's own supply, for judging
 * how much of it a computed ranking actually covers.
 * @param {boolean} [params.enabled=true] Skip fetching until the view needs ranks.
 */
export default function useCollectionRarity({ chainId, collection, totalSupply, enabled = true }) {
  const ready = Boolean(enabled && chainId && collection)

  const { data, isLoading } = useSWR(
    ready ? ['nft-collection-rarity', Number(chainId), collection.toLowerCase()] : null,
    () => getNftCollectionRarity(chainId, collection),
    { revalidateOnFocus: false, revalidateIfStale: false },
  )

  // Built once per response rather than per row — a table of 24 rows would otherwise walk
  // the whole ranking 24 times
  const rankByToken = useMemo(() => {
    const ranks = new Map()
    const tokens = data?.data?.tokens || []
    const values = data?.data?.ranks || []
    tokens.forEach((tokenId, index) => ranks.set(String(tokenId), values[index]))
    return ranks
  }, [data])

  const source = data?.meta?.source || null
  const ranked = data?.meta?.ranked || 0
  const supply = Number(totalSupply) || 0
  const coverage = supply > 0 ? ranked / supply : null

  return {
    rankByToken,
    source,
    ranked,
    // What the rank is out of. A published rank is a position in the whole supply, so that
    // is the denominator when the collection tells us its size — the route can only offer the
    // largest rank it happened to see, which understates a partly-resolved collection. A
    // computed rank is only ever out of the tokens that were scored.
    total: source === 'published' ? supply || data?.meta?.total || ranked : ranked,
    // Labels the scoring ignored for being identifiers rather than traits (computed only)
    ignoredLabels: data?.meta?.ignoredLabels || [],
    coverage,
    // True when the scan hit its ceiling, so the ranking is a sample of a large collection
    truncated: Boolean(data?.meta?.truncated),
    isTrustworthy:
      source === 'published' || (source === 'computed' && (coverage === null || coverage >= COMPUTED_COVERAGE_FLOOR)),
    isLoading: ready && isLoading,
  }
}

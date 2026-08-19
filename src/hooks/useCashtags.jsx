'use client'

/**
 * @file hooks/useCashtags.jsx
 * @description The cashtags a post shows cards for, and their live data.
 *
 * A post may carry an explicit `content.cashtags` list — what its author kept in the composer.
 * When it does not, the symbols are read out of the text with the very same pattern that turns
 * them blue, so older posts and posts written before the composer control get cards too.
 *
 * Only symbols in the curated registry survive either path, and the API re-checks that anyway:
 * a card must never quote a token the app cannot vouch for.
 */

import useSWR from 'swr'
import { CASHTAG_PATTERN } from '@/lib/markdown'
import { CASHTAGS } from '@/config/cashtags'
import { SPARKLINE_RANGE } from '@/lib/priceHistory'

// Past a handful the strip stops being context and becomes the post
const MAX_CARDS = 4

// The compact card charts a week, not the expanded card's default day. Partly because a week
// is the more useful glance next to a post, and partly because a day does not exist for every
// token: DefiLlama carries no intraday history for LUKSO at any granularity, so $LYX drew no
// line at all while the strip was asking for 1D.

const fetcher = (url) => fetch(url).then((res) => (res.ok ? res.json() : { data: {} }))

/** Registry symbols mentioned in a body of text, in order, de-duplicated. */
export const cashtagsIn = (text) => {
  if (typeof text !== 'string' || !text) return []
  const found = []
  // The pattern is global and therefore stateful — matchAll gets a fresh walk each call
  for (const [, , symbol] of text.matchAll(CASHTAG_PATTERN)) {
    const key = symbol.toUpperCase()
    if (CASHTAGS[key] && !found.includes(key)) found.push(key)
  }
  return found
}

/**
 * @param {string} text the post's body
 * @param {string[]} [explicit] the author's kept list, when the post carries one
 * @param {string} [range]
 */
export function useCashtags(text, explicit, range = SPARKLINE_RANGE) {
  const symbols = (Array.isArray(explicit) ? explicit.filter((s) => CASHTAGS[String(s).toUpperCase()]) : cashtagsIn(text)).slice(0, MAX_CARDS)

  // Sorted in the key so two posts citing the same tokens share one request, however each
  // happened to order them
  const key = symbols.length ? `/api/v1/tokens/cashtags?symbols=${[...symbols].sort().join(',')}&range=${range}` : null

  const { data, isLoading } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    // Cards are context, not a trading terminal — the edge cache carries most of this anyway
    refreshInterval: 120_000,
    keepPreviousData: true,
  })

  // Render in the order the author wrote them, not the order the request was keyed in
  const tokens = symbols.map((symbol) => data?.data?.[symbol]).filter(Boolean)

  return { tokens, symbols, isLoading: isLoading && symbols.length > 0 }
}

export default useCashtags

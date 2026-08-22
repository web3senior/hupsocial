'use client'

import useSWR from 'swr'
import { getNftCollectionHistory } from '@/lib/api'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// The shortest window the history route accepts. Today's point is rebuilt from the listings
// live today, which is exactly the current floor — nothing older is needed to read it.
const WINDOW_DAYS = 2

/**
 * The collection's current floor, in base units, with the currency it is quoted in.
 *
 * Same reconstruction the floor chart draws (lib/nftFloorHistory): the floor is derived from
 * which listings were live, and it is quoted in the collection's dominant payment token only —
 * a collection trading in two currencies has a floor that speaks for one of them. Prices in
 * any other token can't be compared against it, which is why the table prints a dash rather
 * than a percentage there.
 * @param {Object} params
 * @param {number|string} params.chainId Chain the collection lives on.
 * @param {string} params.collection NFT contract address.
 * @param {Object} [params.chainInfo] Entry from appChains — fills in the native currency,
 * which store_tokens has no row for.
 * @param {boolean} [params.enabled=true] Skip fetching while the view has no use for it.
 */
export default function useCollectionFloor({ chainId, collection, chainInfo, enabled = true }) {
  const ready = Boolean(enabled && chainId && collection)

  const { data, isLoading } = useSWR(
    ready ? ['nft-collection-floor', Number(chainId), collection.toLowerCase()] : null,
    () => getNftCollectionHistory(chainId, collection, WINDOW_DAYS),
    { revalidateOnFocus: false },
  )

  const series = data?.data || null
  const isNative = !series?.payment_token || series.payment_token === ZERO_ADDRESS

  // Days when nobody was selling carry no floor at all, so walk back to the last day that did
  const floor = [...(series?.points || [])].reverse().find((point) => point.floor !== null)?.floor ?? null

  return {
    floor,
    paymentToken: series?.payment_token || null,
    symbol: series?.symbol || (isNative ? chainInfo?.nativeCurrency?.symbol : '') || '',
    decimals: series?.decimals ?? (isNative ? chainInfo?.nativeCurrency?.decimals : undefined),
    isLoading: ready && isLoading,
  }
}

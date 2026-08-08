'use client'

import useSWR from 'swr'
import { getNftCollectionStats } from '@/lib/api'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/**
 * Lifetime HupTrade market stats for one collection — volume, highest sale, sales settled and
 * how many distinct NFTs changed hands — for the collection header's stat row.
 *
 * Volume and the high sale arrive quoted in the collection's dominant payment token, in base
 * units. Sales in the native coin carry no symbol or decimals (store_tokens has no row for a
 * chain's own currency), so `chainInfo` fills both in here — one place, rather than in every
 * tile that prints a number.
 * @param {Object} params
 * @param {number|string} params.chainId Chain the collection lives on.
 * @param {string} params.collection NFT contract address.
 * @param {Object} [params.chainInfo] Entry from appChains, for the native currency fallback.
 * @param {boolean} [params.enabled=true] Skip fetching while inputs are incomplete.
 */
export default function useCollectionStats({ chainId, collection, chainInfo, enabled = true }) {
  const ready = Boolean(enabled && chainId && collection)

  const { data, error, isLoading } = useSWR(
    ready ? ['nft-collection-stats', Number(chainId), collection.toLowerCase()] : null,
    () => getNftCollectionStats(chainId, collection),
    { revalidateOnFocus: false },
  )

  const stats = data?.data || null
  const isNative = !stats?.payment_token || stats.payment_token === ZERO_ADDRESS

  return {
    volume: stats?.volume || null,
    highestSale: stats?.highest_sale || null,
    saleCount: stats?.sale_count ?? 0,
    itemsSold: stats?.items_sold ?? 0,
    // How many of those sales the quoted totals actually cover — a collection that traded in
    // two currencies has a volume that speaks for only one of them
    quotedSales: stats?.quoted_sales ?? 0,
    currencies: stats?.currencies ?? 0,
    symbol: stats?.symbol || (isNative ? chainInfo?.nativeCurrency?.symbol : '') || '',
    decimals: stats?.decimals ?? (isNative ? chainInfo?.nativeCurrency?.decimals : undefined),
    isLoading: ready && isLoading,
    error,
  }
}

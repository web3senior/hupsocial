'use client'

import { useMemo } from 'react'
import useSWR from 'swr'
import { getNftCollectionTopOffers } from '@/lib/api'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/**
 * The best live offer on each token of one collection, as a lookup by token id.
 *
 * One request for the whole collection rather than one per row: offers are a handful of rows
 * per collection, and a table that asked per token would fire two dozen requests to fill one
 * column.
 * @param {Object} params
 * @param {number|string} params.chainId Chain the collection lives on.
 * @param {string} params.collection NFT contract address.
 * @param {Object} [params.chainInfo] Entry from appChains — fills in the native currency.
 * @param {boolean} [params.enabled=true] Skip fetching until the view needs offers.
 */
export default function useCollectionTopOffers({ chainId, collection, chainInfo, enabled = true }) {
  const ready = Boolean(enabled && chainId && collection)

  const { data, isLoading } = useSWR(
    ready ? ['nft-collection-top-offers', Number(chainId), collection.toLowerCase()] : null,
    () => getNftCollectionTopOffers(chainId, collection),
    { revalidateOnFocus: false },
  )

  // Built once per response rather than per row, and the native currency is resolved here so
  // the cells stay free of chain config
  const offerByToken = useMemo(() => {
    const offers = new Map()

    for (const offer of data?.data || []) {
      const isNative = !offer.payment_token || offer.payment_token === ZERO_ADDRESS

      offers.set(String(offer.token_id), {
        price: offer.price,
        symbol: offer.symbol || (isNative ? chainInfo?.nativeCurrency?.symbol : '') || '',
        decimals: offer.decimals ?? (isNative ? chainInfo?.nativeCurrency?.decimals : undefined),
        count: offer.offers,
      })
    }

    return offers
  }, [data, chainInfo])

  return {
    offerByToken,
    isLoading: ready && isLoading,
  }
}

'use client'

import { useMemo } from 'react'
import useSWR from 'swr'
import { getNftTokenMarket } from '@/lib/api'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/**
 * One token's market record — its live listing, its best live offer, its activity timeline and
 * its sale series — behind the token detail panel's action card and its Activity/Price History
 * tabs.
 *
 * Revalidating rather than immutable: this is a trading surface. An offer can land, expire or
 * be accepted while the panel is open, and a stale action card would offer a reader a price
 * nobody is holding any more.
 *
 * Every price the route returns is base units with its own currency attached, and the native
 * coin arrives with both fields null — so they are filled in here from the chain config once,
 * rather than by each of the four places that render a price.
 * @param {Object} params
 * @param {number|string} params.chainId Chain the collection lives on.
 * @param {string} params.collection NFT contract address.
 * @param {string} params.tokenId Raw token id — either dialect.
 * @param {Object} [params.chainInfo] Entry from appChains, for the native currency.
 * @param {boolean} [params.enabled=true] Skip fetching while inputs are incomplete.
 */
export default function useNftTokenMarket({ chainId, collection, tokenId, chainInfo, enabled = true }) {
  const ready = Boolean(enabled && chainId && collection && tokenId !== undefined && tokenId !== null && tokenId !== '')

  const { data, error, isLoading, mutate } = useSWR(
    ready ? ['nft-token-market', Number(chainId), collection.toLowerCase(), String(tokenId)] : null,
    () => getNftTokenMarket(chainId, collection, tokenId),
    { revalidateOnFocus: false, keepPreviousData: true },
  )

  const resolved = useMemo(() => {
    // The native coin has no store_tokens row, so its symbol and decimals only exist in the
    // chain config. Applied per row, not once per response: a token listed in USDC can still
    // carry a native-coin offer, and one blanket currency would mislabel one of them.
    const withCurrency = (row) => {
      if (!row) return null
      const isNative = !row.payment_token || row.payment_token === ZERO_ADDRESS

      return {
        ...row,
        symbol: row.symbol || (isNative ? chainInfo?.nativeCurrency?.symbol : '') || '',
        decimals: row.decimals ?? (isNative ? chainInfo?.nativeCurrency?.decimals : undefined),
      }
    }

    const payload = data?.data

    return {
      listing: withCurrency(payload?.listing),
      topOffer: withCurrency(payload?.topOffer),
      activity: (payload?.activity || []).map(withCurrency),
      sales: (payload?.sales || []).map(withCurrency),
      // Dollars per whole payment token, keyed by token address — applied per row through
      // lib/usdAmount rather than converted here, since one rate serves every row in that
      // currency. Empty on testnets and for unpriced ERC20s, which render in token terms only.
      usd: payload?.usd || null,
    }
  }, [data, chainInfo])

  return {
    ...resolved,
    isLoading: ready && isLoading,
    error,
    // Re-read after a listing, cancellation, transfer or accepted offer — the panel's own
    // actions change this record, and nothing else would tell it
    refresh: mutate,
  }
}

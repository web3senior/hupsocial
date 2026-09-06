'use client'

import { useCallback, useState } from 'react'
import useSWR from 'swr'
import { getNftTokenInspection } from '@/lib/api'

/**
 * One token's inspection, as the server decoded it. Nothing polls: an inspection is a
 * request-and-answer, and `refresh` asks for a fresh one past the server's memo.
 *
 * @param {Object} params
 * @param {number|string} params.chainId Chain the collection lives on.
 * @param {string|null} params.collection Collection contract address.
 * @param {string|null} params.tokenId Decimal, or bytes32 hex for LSP8.
 * @param {boolean} [params.enabled=true] Skip fetching while inputs are incomplete.
 */
export default function useTokenInspection({ chainId, collection, tokenId, enabled = true }) {
  const ready = Boolean(enabled && chainId && collection && tokenId)
  const key = ready ? ['nft-token-inspection', Number(chainId), collection.toLowerCase(), String(tokenId)] : null

  const { data, error, isLoading, isValidating, mutate } = useSWR(key, () => getNftTokenInspection(chainId, collection, tokenId), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  const [isRefreshing, setIsRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    if (!ready || isRefreshing) return
    setIsRefreshing(true)
    try {
      await mutate(() => getNftTokenInspection(chainId, collection, tokenId, { fresh: true }), { revalidate: false })
    } catch {
      // The hook's `error` already carries it through SWR on the next render
    } finally {
      setIsRefreshing(false)
    }
  }, [ready, isRefreshing, chainId, collection, tokenId, mutate])

  return {
    inspection: data?.data || null,
    error: error || null,
    isLoading: ready && isLoading,
    isValidating,
    isRefreshing,
    refresh,
  }
}

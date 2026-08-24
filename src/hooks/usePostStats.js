'use client'

import useSWR from 'swr'
import { useConnection } from 'wagmi'
import { isSolanaNetworkId } from '@/config/solana'
import { useSolanaWalletStore } from '@/stores/useSolanaWalletStore'
import { getPostById } from '@/lib/api'

/**
 * Builds the shared SWR cache key for a post's live stats, so components outside the
 * hook (e.g. quote-confirm handlers) can mutate the same entry the counters read.
 * @param {Object} post Core content model with network metadata.
 * @param {string} [address] Connected viewer wallet address.
 * @returns {string|null} Cache key, or null when the post has no id.
 */
export function getPostStatsKey(post, address) {
  return post?.id ? `posts/${post.network_id}/${post.id}/${address || 'anonymous'}/stats` : null
}

/**
 * Shared live post stats hook — mirrors the SWR setup in `ui/Like.jsx` but with a
 * single cache key per post so every footer counter (comment, repost, view, ...)
 * dedupes into one `getPostById` request and re-renders together on revalidation.
 * @param {Object} post Core content model with network metadata and counter metrics.
 * @returns {{ stats: Object, mutate: Function }} Fresh post row plus the bound SWR mutate.
 */
export function usePostStats(post) {
  const { address: evmAddress } = useConnection()
  const solanaAddress = useSolanaWalletStore((state) => state.address)
  // The viewer of a Solana post is the Solana wallet — has_reposted / viewer_repost_id key off it
  const address = isSolanaNetworkId(post?.network_id) ? solanaAddress : evmAddress

  const cacheKey = getPostStatsKey(post, address)

  const fetcher = async () => {
    try {
      const res = await getPostById(post.network_id, post.id, address)
      const freshPost = Array.isArray(res?.data) ? res.data[0] : res?.data

      return freshPost || post
    } catch (error) {
      console.error('Failed to sync post stats via API:', error)
      return post
    }
  }

  const { data: stats, mutate } = useSWR(cacheKey, fetcher, {
    fallbackData: post,
    // The feed row already carries every counter this hook reads; without this
    // flag every mounted card refetches its own post row on page load (~3
    // requests x 20 posts). Action handlers revalidate explicitly via mutate().
    revalidateOnMount: false,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  })

  return { stats: stats || post, mutate }
}

export default usePostStats

'use client'

import useSWR from 'swr'
import { useConnection } from 'wagmi'
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
  const { address } = useConnection()

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
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  })

  return { stats: stats || post, mutate }
}

export default usePostStats

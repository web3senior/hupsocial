import { create } from 'zustand'

// Keep restored threads reasonably fresh; older snapshots still paint instantly
// but revalidate in the background.
const COMMENTS_CACHE_TTL_MS = 10 * 60 * 1000
// Bouncing feed → post → feed → post inside this window reuses the snapshot with
// no request at all. Replies only appear once their transaction is indexed, so a
// thread cannot meaningfully change faster than this.
const COMMENTS_FRESH_MS = 30 * 1000
const COMMENTS_PAGE_SIZE = 30

export const commentsCacheKey = (networkId, postId) => `${networkId}:${postId}`

// Requests in flight, keyed by cache key + viewer. The post route's loading.jsx
// and PostDetails both mount <Comments> for the same thread back to back, so
// without this a cold thread would pay for two identical fetches.
const inflight = new Map()

/**
 * In-memory (deliberately NOT persisted) cache of comment threads, keyed per
 * post. Lets the thread repaint after the route unmounts on navigation instead
 * of re-showing the skeleton, the same way useFeedCacheStore does for the feed.
 * A full page reload starts fresh.
 */
export const useCommentsCacheStore = create((set, get) => ({
  caches: {},

  saveCommentsCache: (key, list, address) =>
    set((state) => ({
      caches: { ...state.caches, [key]: { list, address: address ?? null, savedAt: Date.now() } },
    })),

  // Returns null when missing, expired, or saved for a different wallet (the
  // viewer decides is_liked/is_bookmarked on every row). `isFresh` marks a
  // snapshot new enough to skip revalidation entirely.
  readCommentsCache: (key, address) => {
    const entry = get().caches[key]
    if (!entry) return null
    const age = Date.now() - entry.savedAt
    if (age > COMMENTS_CACHE_TTL_MS) return null
    if (entry.address !== (address ?? null)) return null
    return { list: entry.list, isFresh: age < COMMENTS_FRESH_MS }
  },

  // Resolves with the thread and writes it to the cache. Concurrent callers for
  // the same thread share one request.
  fetchComments: (networkId, postId, address) => {
    const key = commentsCacheKey(networkId, postId)
    const requestKey = `${key}|${address ?? null}`
    const pending = inflight.get(requestKey)
    if (pending) return pending

    let url = `/api/v1/networks/${networkId}/${postId}/comments?page=1&limit=${COMMENTS_PAGE_SIZE}`
    if (address) url += `&viewer_address=${encodeURIComponent(address)}`

    const request = fetch(url)
      .then((res) => res.json())
      .then((json) => {
        if (!json?.success) throw new Error('Comments request failed')
        const list = json.data ?? []
        get().saveCommentsCache(key, list, address)
        return list
      })
      .finally(() => inflight.delete(requestKey))

    inflight.set(requestKey, request)
    return request
  },
}))

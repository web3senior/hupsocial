import { create } from 'zustand'

// Keep restored feeds reasonably fresh; older snapshots fall back to a normal fetch.
const FEED_CACHE_TTL_MS = 10 * 60 * 1000

/**
 * In-memory (deliberately NOT persisted) cache of home feed state, keyed per
 * feed scope ('foryou', 'network-<chainId>'). Lets a feed tab restore its
 * loaded posts and scroll position after the route unmounts on navigation,
 * instead of re-showing the shimmer. A full page reload starts fresh.
 */
export const useFeedCacheStore = create((set, get) => ({
  caches: {},

  saveFeedCache: (key, entry) =>
    set((state) => ({
      caches: { ...state.caches, [key]: { ...entry, savedAt: Date.now() } },
    })),

  // Returns null when missing, expired, or saved for a different wallet.
  readFeedCache: (key, address) => {
    const entry = get().caches[key]
    if (!entry) return null
    if (Date.now() - entry.savedAt > FEED_CACHE_TTL_MS) return null
    if ((entry.address ?? null) !== (address ?? null)) return null
    return entry
  },
}))

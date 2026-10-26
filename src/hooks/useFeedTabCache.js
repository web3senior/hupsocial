'use client'

import { useEffect, useRef, useState } from 'react'
import { useFeedCacheStore } from '@/stores/useFeedCacheStore'
import { useFeedScrollRestore } from '@/hooks/useFeedScrollRestore'

/**
 * Session cache for a home feed tab, the same one the For you feed keeps (tabs/HomeFeedTab):
 * switching away and back repaints the loaded posts at the reader's place instead of
 * refetching page 1 behind a skeleton.
 *
 * Seed state from `initialCache`, report the cacheable state every render through `remember`
 * (an object with a non-empty `list`), and spread `containerRef`/`containerStyle` on the feed
 * and `data-post-key` + `cardStyle(key)` on each card so the scroll position comes back too.
 *
 * @param {string} key Feed scope in the cache, e.g. 'trending' or 'following-<chainId>'
 * @param {string|null} address Viewer the cached rows were fetched for (like state differs per wallet)
 */
export function useFeedTabCache(key, address) {
  const saveFeedCache = useFeedCacheStore((state) => state.saveFeedCache)
  // Read once per mount; the store is in-memory, so this is empty during SSR hydration
  const [initialCache] = useState(() => useFeedCacheStore.getState().readFeedCache(key, address ?? null))
  const containerRef = useRef(null)
  const stateRef = useRef(null)

  // A cached feed's cards are in the tree from the first render, so it is ready right away
  const { snapshot, containerStyle, cardStyle } = useFeedScrollRestore({
    containerRef,
    restore: initialCache,
    ready: Boolean(initialCache),
  })

  // Snapshot on exit: tab switch, navigation, or a scope change such as a new chain
  useEffect(() => {
    return () => {
      const state = stateRef.current
      if (!state || !state.list?.length) return
      saveFeedCache(key, { ...state, address: address ?? null, ...snapshot() })
    }
  }, [key, address, saveFeedCache, snapshot])

  const remember = (state) => {
    stateRef.current = state
  }

  return { initialCache, remember, containerRef, containerStyle, cardStyle }
}

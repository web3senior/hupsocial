'use client'

import { getListPosts, invalidateLists, readListState, saveListState, writeList } from '@/db/lists'
import { isPostRow } from '@/db/posts'

/**
 * @file db/feedCache.js
 * @description Session snapshots of feed-like surfaces, keyed per feed scope ('foryou',
 * 'network-<chainId>', 'profile-<wallet>-<postType>', 'search', …). Lets a feed restore its loaded
 * posts and the reader's place (see hooks/useFeedScrollRestore) after the route unmounts on
 * navigation, instead of re-showing the shimmer. A full page reload starts fresh.
 *
 * The snapshot's posts are stored as a list in the shared post store rather than as a copy, so a
 * restored feed paints each post as it is now — liked, edited or deleted since — not as it was
 * when the reader left.
 */

// Keep restored feeds reasonably fresh; older snapshots fall back to a normal fetch.
const FEED_CACHE_TTL_MS = 10 * 60 * 1000

// The list a feed's posts live in; a feed that writes its pages straight into it (tabs/HomeFeedTab)
// only has to record its state on exit, through saveFeedState
export const feedScope = (key) => `feed:${key}`

/**
 * @param {string} key Feed scope.
 * @param {Object} entry `{ list?, address, ...state }`; everything besides `list` and `address`
 *   comes back as-is from readFeedCache.
 */
export function saveFeedCache(key, { list, address = null, ...rest }) {
  const scope = feedScope(key)
  if (!Array.isArray(list)) {
    saveListState(scope, { address, meta: rest })
    return
  }
  // A list holding anything but post rows cannot point into the post store; it is kept as is
  if (!list.every(isPostRow)) {
    saveListState(scope, { address, meta: { ...rest, rawList: list } })
    return
  }
  writeList(scope, list, { mode: 'replace', state: { address, meta: { ...rest, hasList: true } } })
}

/**
 * Records a feed's state for a list it already keeps in feedScope(key) itself.
 * @param {string} key Feed scope.
 * @param {Object} entry `{ address, ...state }`
 */
export function saveFeedState(key, { address = null, ...rest }) {
  saveListState(feedScope(key), { address, meta: { ...rest, hasList: true } })
}

/**
 * @returns {Object|null} The saved entry with its `list` read back from the post store; null when
 *   missing, expired, or saved for a different wallet (rows carry per-viewer flags).
 */
export function readFeedCache(key, address) {
  const scope = feedScope(key)
  const state = readListState(scope, address, FEED_CACHE_TTL_MS)
  if (!state) return null

  const { rawList, hasList, ...meta } = state.meta ?? {}
  const entry = { ...meta, address: state.address, savedAt: state.savedAt }
  if (rawList) entry.list = rawList
  else if (hasList) entry.list = getListPosts(scope)
  return entry
}

/** Stops every feed snapshot from being restored, e.g. once the viewer's block list changes. */
export function clearFeedCaches() {
  invalidateLists('feed:')
}

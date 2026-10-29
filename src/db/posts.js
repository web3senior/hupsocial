'use client'

import { eq, useLiveQuery } from '@tanstack/react-db'
import { postsCollection, runInTransaction } from '@/db/collections'

// Post ids are per network — every chain's HupCommunity numbers its own posts from 1 — so a
// cross-network feed routinely holds two different posts with the same id. Identity is the pair.
export const postKey = (post) => `${post.network_id}:${post.id}`

// Rows some surfaces list without a network (or ids at all) cannot be normalized; callers keep
// those lists raw — see db/feedCache.
export const isPostRow = (row) => row != null && row.id != null && row.network_id != null

/**
 * Writes rows into the shared post store, replacing what an older fetch left for the same post.
 * A repost's embedded original is a post in its own right and is stored alongside it, so the
 * post page and any quote of it paint from the same row.
 * Fields a lighter endpoint leaves out are kept from the copy already held.
 * @param {Array<Object>} rows Post rows straight from the API.
 * @returns {Array<string>} The rows' keys, in the order given (duplicates dropped).
 */
export function upsertPosts(rows) {
  const byKey = collectPostRows(rows)
  if (byKey.size) runInTransaction(() => writePostsInTransaction(byKey))
  return listKeys(rows)
}

/**
 * The rows to store for a page, by key: each row plus any embedded repost original.
 * @param {Array<Object>} rows
 * @returns {Map<string, Object>}
 */
export function collectPostRows(rows) {
  const byKey = new Map()
  for (const row of rows ?? []) {
    if (!isPostRow(row)) continue
    if (isPostRow(row.repost_original) && !byKey.has(postKey(row.repost_original))) {
      byKey.set(postKey(row.repost_original), row.repost_original)
    }
    byKey.set(postKey(row), row)
  }
  return byKey
}

/**
 * The page's own keys in order, duplicates dropped (embedded originals are not listed).
 * @param {Array<Object>} rows
 * @returns {Array<string>}
 */
export const listKeys = (rows) => [...new Set((rows ?? []).filter(isPostRow).map(postKey))]

/**
 * The write half of upsertPosts, for callers already inside runInTransaction.
 * @param {Map<string, Object>} byKey
 */
export function writePostsInTransaction(byKey) {
  const fresh = []
  for (const [key, liveRow] of byKey) {
    const row = stripVirtualProps(liveRow)
    if (postsCollection.has(key)) {
      postsCollection.update(key, (draft) => {
        Object.assign(draft, row)
      })
    } else {
      fresh.push({ ...row, post_key: key })
    }
  }
  if (fresh.length) postsCollection.insert(fresh)
}

// Rows read back out of a live query carry TanStack DB's computed `$key`, `$origin`… — a card
// handing its row to seedPost must not write those into storage.
const stripVirtualProps = (row) => {
  if (!Object.keys(row).some((field) => field.startsWith('$'))) return row
  return Object.fromEntries(Object.entries(row).filter(([field]) => !field.startsWith('$')))
}

/**
 * Puts one row in the store ahead of a navigation, so the post page (or its loading boundary)
 * paints it in the first frame.
 * @param {Object} row
 */
export function seedPost(row) {
  if (isPostRow(row)) upsertPosts([row])
}

/**
 * The stored row for a post, read once (not subscribed).
 * @returns {Object|undefined}
 */
export function getPost(networkId, postId) {
  if (networkId == null || postId == null) return undefined
  return postsCollection.get(`${networkId}:${postId}`)
}

/**
 * The stored row for a post, kept current as any surface refetches or rewrites it.
 * @returns {Object|undefined} Undefined until some surface has stored the post.
 */
export function usePost(networkId, postId) {
  const key = networkId != null && postId != null ? `${networkId}:${postId}` : null
  const { data } = useLiveQuery({
    query: (q) => {
      if (!key) return undefined
      return q
        .from({ post: postsCollection })
        .where(({ post }) => eq(post.post_key, key))
        .findOne()
    },
  })
  return data ?? undefined
}

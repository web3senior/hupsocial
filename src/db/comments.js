'use client'

import { commentsPageUrl, DEFAULT_COMMENTS_SORT } from '@/lib/commentsRequest'
import { invalidateLists, writeList } from '@/db/lists'

/**
 * @file db/comments.js
 * @description Comment threads as lists in the shared post store. A reply is a post, so the row
 * a thread shows is the same row its own post page and any feed show.
 */

// Bouncing feed → post → feed → post inside this window reuses the thread with no request at
// all. Replies only appear once their transaction is indexed, so a thread cannot meaningfully
// change faster than this.
export const COMMENTS_FRESH_MS = 30 * 1000

// One thread, whatever its order: what a viewer's reply invalidates
const threadPrefix = (networkId, postId) => `thread:${networkId}:${postId}|`

// One ordering of a thread: the list its replies are kept in
export const commentsScope = (networkId, postId, sort = DEFAULT_COMMENTS_SORT) => `${threadPrefix(networkId, postId)}${sort}`

// Requests in flight, keyed by scope + viewer. The post route's loading.jsx and PostDetails both
// mount <Comments> for the same thread back to back, so without this a cold thread would pay for
// two identical fetches.
const inflight = new Map()

/**
 * Fetches a thread's first page into its list. Concurrent callers for the same thread share one
 * request.
 * @returns {Promise<Array<Object>>}
 */
export function fetchThread(networkId, postId, viewer, sort = DEFAULT_COMMENTS_SORT) {
  const scope = commentsScope(networkId, postId, sort)
  const requestKey = `${scope}|${viewer ?? null}`
  const pending = inflight.get(requestKey)
  if (pending) return pending

  // The same URL the post page preloads for a document load, so the browser can hand this fetch
  // the response it already started on
  const request = fetch(commentsPageUrl(networkId, postId, viewer, 1, sort))
    .then((res) => res.json())
    .then((json) => {
      if (!json?.success) throw new Error('Comments request failed')
      const list = json.data ?? []
      writeList(scope, list, { mode: 'replace', state: { address: viewer ?? null } })
      return list
    })
    .finally(() => inflight.delete(requestKey))

  inflight.set(requestKey, request)
  return request
}

/**
 * The viewer's own reply finished indexing: every ordering of the thread is stale, and any
 * mounted <Comments> for it refetches (it watches its list's state).
 */
export function invalidateThread(networkId, postId) {
  invalidateLists(threadPrefix(networkId, postId))
}

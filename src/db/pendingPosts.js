'use client'

import { useLiveQuery } from '@tanstack/react-db'
import { pendingPostsCollection, runInTransaction } from '@/db/collections'

/**
 * @file db/pendingPosts.js
 * @description The posts this session has sent onchain but has not yet seen come back indexed.
 *
 * Each entry is drawn at the top of the feed as a ghost card (components/PendingPost) so the
 * author watches their post sit where it will land instead of watching a toast spin. Filled and
 * emptied by lib/postPublication, which is the only thing that knows what became of a submission.
 *
 * Deliberately not persisted: a ghost is a promise that a transaction already in flight is about
 * to land. After a reload nothing is in flight any more — the post is either indexed (and in the
 * feed on its own) or gone.
 *
 * Entry shape: `{ id, networkId, author, content, createdAt, status: 'publishing'|'indexed',
 * resolvedKey, held, progress, metadata }`. `resolvedKey` is the indexed row's `network_id:id`,
 * set the moment the indexer answers. The feed keeps drawing the ghost until that exact row is in
 * its list, so the swap never leaves a gap where neither the ghost nor the post is on screen.
 */

// Ghosts draw oldest first
let sequence = 0

/**
 * Adds a ghost, or takes over the one already up under the same id in place — a composer that
 * closed at the tap put its card up before anything was pinned, and the handover to the real
 * submission must not blink it out and back.
 * @param {Object} entry
 */
export function addPendingPost(entry) {
  runInTransaction(() => {
    if (pendingPostsCollection.has(entry.id)) {
      pendingPostsCollection.update(entry.id, (draft) => {
        Object.assign(draft, entry)
      })
    } else {
      pendingPostsCollection.insert({ ...entry, order: ++sequence })
    }
  })
}

/**
 * @param {string} id
 * @param {Object} patch
 */
export function updatePendingPost(id, patch) {
  if (!pendingPostsCollection.has(id)) return
  runInTransaction(() =>
    pendingPostsCollection.update(id, (draft) => {
      Object.assign(draft, patch)
    })
  )
}

/** @param {string} id */
export function removePendingPost(id) {
  if (pendingPostsCollection.has(id)) runInTransaction(() => pendingPostsCollection.delete(id))
}

/** @returns {Object|undefined} */
export const getPendingPost = (id) => pendingPostsCollection.get(id)

/**
 * Every ghost in flight, oldest first, live.
 * @returns {Array<Object>}
 */
export function usePendingPosts() {
  const { data } = useLiveQuery({
    query: (q) => q.from({ ghost: pendingPostsCollection }).orderBy(({ ghost }) => ghost.order, 'asc'),
  })
  return data ?? EMPTY
}

const EMPTY = []

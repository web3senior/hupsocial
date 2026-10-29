import { BasicIndex, createCollection, createTransaction, localOnlyCollectionOptions } from '@tanstack/react-db'

/**
 * @file db/collections.js
 * @description The session's client-side store for posts, built on TanStack DB. Every surface
 * that shows a post — feeds, the post page, comment threads, quote and repost cards — reads the
 * same normalized row, so a post fetched or rewritten in one place is current everywhere.
 *
 * All four collections are in-memory and deliberately not persisted, the same lifetime the
 * zustand caches they replace had: client navigation keeps them, a full page reload starts fresh.
 * `gcTime: 0` turns off TanStack DB's idle teardown — these are the session cache, so they must
 * survive the moments when no component happens to be subscribed (between two routes).
 * Eager auto-indexing covers the fields lists join and filter on (post_key, scope).
 */

const sessionCollection = (id, getKey) =>
  createCollection(
    localOnlyCollectionOptions({
      id,
      getKey,
      gcTime: 0,
      startSync: true,
      autoIndex: 'eager',
      defaultIndexType: BasicIndex,
    })
  )

// One row per post (comments are posts too), keyed by `post_key` — see db/posts.postKey
export const postsCollection = sessionCollection('posts', (row) => row.post_key)

// Membership of a post in an ordered list: a feed scope ('feed:foryou', 'feed:profile-…') or a
// comment thread ('thread:…'). `{ id: '<scope>|<post_key>', scope, post_key, position }`
export const listEntriesCollection = sessionCollection('list-entries', (row) => row.id)

// What a list was fetched for and how far it got: `{ id: <scope>, address, savedAt, meta }`.
// `meta` holds whatever the owning surface needs back (page, hasMore, its scroll snapshot…).
export const listsCollection = sessionCollection('lists', (row) => row.id)

// The viewer's own posts sent onchain but not yet seen indexed, drawn as ghost cards at the top
// of the feed. Shape documented in db/pendingPosts.
export const pendingPostsCollection = sessionCollection('pending-posts', (row) => row.id)

const COLLECTIONS = [postsCollection, listEntriesCollection, listsCollection, pendingPostsCollection]

/**
 * Applies several writes, across any of the collections above, as one transaction — subscribers
 * see the whole change or none of it, so swapping a feed's page never paints an empty frame
 * between the old rows going and the new ones arriving.
 * @param {Function} write Synchronous; every insert/update/delete inside it joins the transaction.
 */
export function runInTransaction(write) {
  const tx = createTransaction({
    mutationFn: async ({ transaction }) => {
      COLLECTIONS.forEach((collection) => collection.utils.acceptMutations(transaction))
    },
  })
  tx.mutate(write)
  return tx
}

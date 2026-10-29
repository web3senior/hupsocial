'use client'

import { eq, useLiveQuery } from '@tanstack/react-db'
import { listEntriesCollection, listsCollection, postsCollection, runInTransaction } from '@/db/collections'
import { collectPostRows, listKeys, writePostsInTransaction } from '@/db/posts'

/**
 * @file db/lists.js
 * @description Ordered lists of posts — a feed scope or a comment thread — kept as membership
 * rows pointing at the shared post store rather than as copies of the posts. A list therefore
 * always renders the newest copy of each post, whichever surface fetched it last.
 */

const entryId = (scope, key) => `${scope}|${key}`

const scopeEntries = (scope) => listEntriesCollection.toArray.filter((entry) => entry.scope === scope)

/**
 * Writes a page of rows into a list, and the rows themselves into the post store, as one change.
 * Rows already in the list keep their place on append/prepend (first occurrence wins), the same
 * dedupe every feed did on its own before.
 * @param {string} scope
 * @param {Array<Object>} rows
 * @param {Object} [options]
 * @param {'replace'|'append'|'prepend'} [options.mode] `replace` makes the list exactly `rows`.
 * @param {Object} [options.state] When given, also records the list's state (see saveListState).
 * @returns {number} How many rows were new to the list.
 */
export function writeList(scope, rows, { mode = 'replace', state = null } = {}) {
  const byKey = collectPostRows(rows)
  const keys = listKeys(rows)
  const existing = scopeEntries(scope)
  const existingByKey = new Map(existing.map((entry) => [entry.post_key, entry]))
  let added = 0

  runInTransaction(() => {
    if (byKey.size) writePostsInTransaction(byKey)

    if (mode === 'replace') {
      const wanted = new Set(keys)
      const stale = existing.filter((entry) => !wanted.has(entry.post_key)).map((entry) => entry.id)
      if (stale.length) listEntriesCollection.delete(stale)
      const fresh = []
      keys.forEach((key, position) => {
        const entry = existingByKey.get(key)
        if (entry) {
          if (entry.position !== position) {
            listEntriesCollection.update(entry.id, (draft) => {
              draft.position = position
            })
          }
        } else {
          fresh.push({ id: entryId(scope, key), scope, post_key: key, position })
        }
      })
      if (fresh.length) listEntriesCollection.insert(fresh)
      added = fresh.length
    } else {
      const newKeys = keys.filter((key) => !existingByKey.has(key))
      const positions = existing.map((entry) => entry.position)
      const start =
        mode === 'prepend'
          ? (positions.length ? Math.min(...positions) : 0) - newKeys.length
          : positions.length ? Math.max(...positions) + 1 : 0
      if (newKeys.length) {
        listEntriesCollection.insert(newKeys.map((key, i) => ({ id: entryId(scope, key), scope, post_key: key, position: start + i })))
      }
      added = newKeys.length
    }

    if (state) writeListStateInTransaction(scope, state)
  })

  return added
}

/**
 * Empties a list (its posts stay in the store for every other surface).
 * @param {string} scope
 */
export function clearList(scope) {
  const ids = scopeEntries(scope).map((entry) => entry.id)
  runInTransaction(() => {
    if (ids.length) listEntriesCollection.delete(ids)
    if (listsCollection.has(scope)) listsCollection.delete(scope)
  })
}

/**
 * The list's posts in order, read once — for async callbacks that must diff against the list as
 * it stands when a response lands, not as it stood when the request left.
 * @param {string} scope
 * @returns {Array<Object>}
 */
export function getListPosts(scope) {
  return scopeEntries(scope)
    .sort((a, b) => a.position - b.position)
    .map((entry) => postsCollection.get(entry.post_key))
    .filter(Boolean)
}

/**
 * The list's posts in order, live: a post refetched, edited or removed anywhere updates here.
 * @param {string|null} scope Null disables the query.
 * @returns {Array<Object>}
 */
export function useListPosts(scope) {
  const { data } = useLiveQuery({
    query: (q) => {
      if (!scope) return undefined
      return q
        .from({ entry: listEntriesCollection })
        .innerJoin({ post: postsCollection }, ({ entry, post }) => eq(entry.post_key, post.post_key))
        .where(({ entry }) => eq(entry.scope, scope))
        .orderBy(({ entry }) => entry.position, 'asc')
        .select(({ post }) => ({ ...post }))
    },
  })
  return data ?? EMPTY
}

const EMPTY = []

function writeListStateInTransaction(scope, { address = null, meta = {} }) {
  const row = { id: scope, address: address ?? null, savedAt: Date.now(), meta }
  if (listsCollection.has(scope)) {
    listsCollection.update(scope, (draft) => {
      Object.assign(draft, row)
    })
  } else {
    listsCollection.insert(row)
  }
}

/**
 * Records what a list was fetched for and whatever its surface needs to resume it.
 * @param {string} scope
 * @param {{ address?: string|null, meta?: Object }} state
 */
export function saveListState(scope, state) {
  runInTransaction(() => writeListStateInTransaction(scope, state))
}

/**
 * The list's recorded state, if it is still worth resuming.
 * @param {string} scope
 * @param {string|null} address Viewer asking — rows carry per-viewer flags (is_liked…).
 * @param {number} maxAgeMs
 * @returns {{ address: string|null, savedAt: number, meta: Object }|null}
 */
export function readListState(scope, address, maxAgeMs) {
  const row = listsCollection.get(scope)
  if (!row) return null
  if (Date.now() - row.savedAt > maxAgeMs) return null
  if ((row.address ?? null) !== (address ?? null)) return null
  return row
}

/**
 * Marks every list under a prefix as stale without emptying it: a mounted surface keeps painting
 * what it has while it refetches, and the next mount no longer trusts the snapshot.
 * @param {string} prefix
 */
export function invalidateLists(prefix) {
  const ids = listsCollection.toArray.filter((row) => row.id.startsWith(prefix)).map((row) => row.id)
  if (!ids.length) return
  // Aged rather than deleted: a live reader of the state (useListState) sees savedAt move and
  // refetches, while still knowing which viewer the rows on screen belong to
  runInTransaction(() =>
    listsCollection.update(ids, (drafts) => {
      drafts.forEach((draft) => {
        draft.savedAt = 0
      })
    })
  )
}

/**
 * The list's recorded state, live — so a surface can tell when someone else invalidated it.
 * @param {string|null} scope
 * @returns {Object|undefined}
 */
export function useListState(scope) {
  const { data } = useLiveQuery({
    query: (q) => {
      if (!scope) return undefined
      return q
        .from({ list: listsCollection })
        .where(({ list }) => eq(list.id, scope))
        .findOne()
    },
  })
  return data ?? undefined
}

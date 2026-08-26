'use client'

import { create } from 'zustand'

/**
 * The posts this session has sent onchain but has not yet seen come back indexed.
 *
 * Each entry is drawn at the top of the feed as a ghost card (components/PendingPost) so the
 * author watches their post sit where it will land instead of watching a toast spin. Filled and
 * emptied by lib/postPublication, which is the only thing that knows what became of a submission.
 *
 * Deliberately not persisted: a ghost is a promise that a transaction already in flight is about
 * to land. After a reload nothing is in flight any more — the post is either indexed (and in the
 * feed on its own) or gone.
 */
export const usePendingPostStore = create((set) => ({
  // { id, networkId, author, content, createdAt, status: 'publishing'|'indexed', resolvedKey }
  // `resolvedKey` is the indexed row's `network_id:id`, set the moment the indexer answers. The
  // feed keeps drawing the ghost until that exact row is in its list, so the swap never leaves
  // a gap where neither the ghost nor the post is on screen.
  pending: [],

  addPendingPost: (entry) =>
    set((state) => ({ pending: [...state.pending.filter((item) => item.id !== entry.id), entry] })),

  updatePendingPost: (id, patch) =>
    set((state) => ({ pending: state.pending.map((item) => (item.id === id ? { ...item, ...patch } : item)) })),

  removePendingPost: (id) => set((state) => ({ pending: state.pending.filter((item) => item.id !== id) })),
}))

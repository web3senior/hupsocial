'use client'

import { create } from 'zustand'

/**
 * Holds the one submission the chain rejected after its composer had already closed.
 *
 * Deliberately not persisted: a recovery is a live offer to sign again, and a composer that
 * came back after a reload — pointing at a transaction from a session that is over — would be
 * a ghost rather than a rescue. The plain-post draft still survives a reload on its own, in
 * localStorage (see NewPost's loadDraftContent).
 */
export const useComposerStore = create((set) => ({
  // { id, props, state } — `props` re-open the same kind of composer (reply, quote, edit,
  // community post), `state` carries the content and settings it held when it was submitted.
  recovery: null,

  restoreComposer: (recovery) => {
    if (!recovery) return
    // A fresh id per failure, so a second rejection remounts the composer instead of leaving
    // the first one's state on screen
    set({ recovery: { ...recovery, id: `${Date.now()}` } })
  },

  clearRecovery: () => set({ recovery: null }),
}))

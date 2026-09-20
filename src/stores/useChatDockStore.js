'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

const prefix = process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX || ''

/** @typedef {'minimized'|'open'|'expanded'} ChatDockMode */

/**
 * The chat dock's mode (a pill, a card, or a taller card) and the newest room message the
 * reader has seen. Persisted so the dock comes back the way it was left, the unread badge counts
 * from the right place, and the room reopens at the line the reader left on.
 */
export const useChatDockStore = create(
  persist(
    (set) => ({
      mode: 'minimized',
      lastSeenId: 0,
      // Where the open card was dragged to, as a shift from its corner seat
      offset: { x: 0, y: 0 },
      setOffset: (offset) => set({ offset }),
      // The wallet last seen connected, so a reload can wait for it before painting the room
      lastAddress: null,
      setLastAddress: (lastAddress) => set({ lastAddress }),
      setMode: (mode) => set({ mode }),
      minimize: () => set({ mode: 'minimized' }),
      open: () => set({ mode: 'open' }),
      toggleExpanded: () => set((state) => ({ mode: state.mode === 'expanded' ? 'open' : 'expanded' })),
      markSeen: (id) => set((state) => (id > state.lastSeenId ? { lastSeenId: id } : {})),
    }),
    {
      name: `${prefix}chat-dock`,
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ mode: state.mode, lastSeenId: state.lastSeenId, offset: state.offset, lastAddress: state.lastAddress }),
      migrate: (persisted) => ({
        mode: persisted?.mode ?? (persisted?.isOpen ? 'open' : 'minimized'),
        lastSeenId: persisted?.lastSeenId ?? 0,
        offset: persisted?.offset ?? { x: 0, y: 0 },
        lastAddress: persisted?.lastAddress ?? null,
      }),
    }
  )
)

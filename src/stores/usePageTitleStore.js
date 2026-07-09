'use client'

import { create } from 'zustand'

// Runtime-only store (no persist middleware): the title belongs to the
// currently mounted route, so rehydrating a stale value from localStorage
// would flash the previous page's title on load.
export const usePageTitleStore = create((set) => ({
  title: '',

  setTitle: (title) => set({ title }),
  clearTitle: () => set({ title: '' }),
}))

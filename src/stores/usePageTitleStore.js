'use client'

import { create } from 'zustand'

// Runtime-only store (no persist middleware): the title belongs to the
// currently mounted route, so rehydrating a stale value from localStorage
// would flash the previous page's title on load.
export const usePageTitleStore = create((set) => ({
  title: '',
  // Muted second line under the title
  subtitle: '',
  // Optional { href, label } the Header renders as a back arrow before the title
  back: null,
  // data-width step the Header seats the title in, matching the page's own container
  width: '',

  setTitle: (title, { subtitle = '', back = null, width = '' } = {}) => set({ title, subtitle, back, width }),
  clearTitle: () => set({ title: '', subtitle: '', back: null, width: '' }),
}))

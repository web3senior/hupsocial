'use client'

import { useCallback, useSyncExternalStore } from 'react'

const PREFIX = process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX

// Density, not content: every layout shows the same items, so switching is free and
// nothing has to refetch
export const GRID_LAYOUTS = ['comfortable', 'compact', 'list']

// One store per key, the same shape usePreferredLanguage uses: a browser-only preference
// read through useSyncExternalStore rather than an effect, so every grid reading the same
// key moves together and other tabs follow via the storage event
const stores = new Map()

const storeFor = (key, fallback) => {
  const existing = stores.get(key)
  if (existing) return existing

  const storageKey = `${PREFIX}${key}`
  const listeners = new Set()
  let value

  const read = () => {
    const stored = localStorage.getItem(storageKey)
    return stored && GRID_LAYOUTS.includes(stored) ? stored : fallback
  }

  const notify = () => listeners.forEach((listener) => listener())

  const handleStorage = (event) => {
    if (event.key && event.key !== storageKey) return
    value = read()
    notify()
  }

  const store = {
    subscribe: (listener) => {
      listeners.add(listener)
      window.addEventListener('storage', handleStorage)

      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) window.removeEventListener('storage', handleStorage)
      }
    },
    getSnapshot: () => {
      if (value === undefined) value = read()
      return value
    },
    // The server has no localStorage, so it renders the fallback and React swaps the
    // reader's own choice in after hydration
    getServerSnapshot: () => fallback,
    set: (next) => {
      if (!GRID_LAYOUTS.includes(next) || next === value) return
      localStorage.setItem(storageKey, next)
      value = next
      notify()
    },
  }

  stores.set(key, store)
  return store
}

/**
 * Remember which grid density a reader picked, per surface.
 * @param {string} key Storage key suffix, e.g. 'nft-collection-layout'.
 * @param {string} [fallback='comfortable'] Layout for a reader who has never chosen.
 * @returns {[string, Function]} The current layout and a setter that persists it.
 */
export default function useGridLayout(key, fallback = 'comfortable') {
  const store = storeFor(key, fallback)
  const layout = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot)
  const choose = useCallback((next) => store.set(next), [store])

  return [layout, choose]
}

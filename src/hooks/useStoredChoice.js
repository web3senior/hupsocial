'use client'

import { useCallback, useSyncExternalStore } from 'react'

const PREFIX = process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX

// One store per key, the same shape usePreferredLanguage uses: a browser-only preference read
// through useSyncExternalStore rather than an effect, so every control reading the same key moves
// together and other tabs follow via the storage event.
const stores = new Map()

// Storage is unavailable in a locked-down browser and throws on access rather than returning
// null, so every touch is guarded — a filter that cannot be remembered still has to work.
const readStorage = (storageKey) => {
  try {
    return localStorage.getItem(storageKey)
  } catch {
    return null
  }
}

const writeStorage = (storageKey, next) => {
  try {
    localStorage.setItem(storageKey, next)
  } catch {
    // Nothing to do: the choice still applies for this session, it just will not outlive it
  }
}

const storeFor = (key, values, fallback) => {
  const existing = stores.get(key)

  if (existing) {
    // The caller's list is the source of truth on every render, not just the first: a surface
    // whose options arrive with its data would otherwise keep validating against the empty list
    // it mounted with
    existing.values = values
    existing.fallback = fallback
    return existing
  }

  const storageKey = `${PREFIX}${key}`
  const listeners = new Set()

  const store = {
    values,
    fallback,
    value: undefined,
  }

  const read = () => {
    const stored = readStorage(storageKey)
    return stored && store.values.includes(stored) ? stored : store.fallback
  }

  const notify = () => listeners.forEach((listener) => listener())

  const handleStorage = (event) => {
    if (event.key && event.key !== storageKey) return
    store.value = read()
    notify()
  }

  store.subscribe = (listener) => {
    listeners.add(listener)
    window.addEventListener('storage', handleStorage)

    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) window.removeEventListener('storage', handleStorage)
    }
  }

  // Re-read when the cached answer is no longer one of the options — the list can widen or
  // narrow under a store that outlives the mount that created it
  store.getSnapshot = () => {
    if (store.value === undefined || !store.values.includes(store.value)) store.value = read()
    return store.value
  }

  // The server has no localStorage, so it renders the fallback and React swaps the reader's own
  // choice in after hydration
  store.getServerSnapshot = () => store.fallback

  store.set = (next) => {
    if (!store.values.includes(next) || next === store.value) return
    writeStorage(storageKey, next)
    store.value = next
    notify()
  }

  stores.set(key, store)
  return store
}

/**
 * Remember which of a fixed set of choices a reader picked, per surface.
 * Backs every segmented filter in the app: the selection is a habit rather than a piece of the
 * page's data, so it stays out of the URL and survives a reload instead.
 * @param {string} key Storage key suffix, e.g. 'activity-filter'.
 * @param {string[]} values Every valid choice. Anything else in storage is ignored.
 * @param {string} [fallback] Choice for a reader who has never picked. Defaults to the first.
 * @returns {[string, Function]} The current choice and a setter that persists it.
 */
export default function useStoredChoice(key, values, fallback = values[0]) {
  const store = storeFor(key, values, fallback)
  const value = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot)
  const choose = useCallback((next) => store.set(next), [store])

  return [value, choose]
}

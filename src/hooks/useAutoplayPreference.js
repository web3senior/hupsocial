'use client'

import { useSyncExternalStore } from 'react'

const STORAGE_KEY = `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}autoplay-videos`

// Every video on the page reads this, so flipping it in Settings has to reach all of them at
// once — a module store rather than per-component state, the same shape usePreferredLanguage
// uses, which also gets cross-tab sync for free.
const listeners = new Set()
let enabled

const notify = () => listeners.forEach((listener) => listener())

/* Off unless the reader turned it on. Video that starts by itself costs data the reader never
   agreed to spend and moves under their eyes while they are reading something else — the poster
   frame plus a play button says the same thing without taking the decision away. */
const readPreference = () => localStorage.getItem(STORAGE_KEY) === 'true'

const handleStorage = (event) => {
  if (event.key && event.key !== STORAGE_KEY) return
  enabled = readPreference()
  notify()
}

const subscribe = (listener) => {
  listeners.add(listener)
  window.addEventListener('storage', handleStorage)

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('storage', handleStorage)
  }
}

const getSnapshot = () => {
  if (enabled === undefined) enabled = readPreference()
  return enabled
}

// Browser state, so the server renders the paused form and React swaps in the reader's choice
// after hydration
const getServerSnapshot = () => false

/**
 * Persist the autoplay choice and wake every player on the page.
 * @param {boolean} value
 */
export const setAutoplayPreference = (value) => {
  localStorage.setItem(STORAGE_KEY, String(value))
  enabled = value
  notify()
}

/**
 * Whether videos should start on their own when they scroll into view.
 * @returns {boolean}
 */
export const useAutoplayPreference = () => useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

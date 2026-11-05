'use client'

import { useSyncExternalStore } from 'react'

const STORAGE_KEY = `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}hide-header-balances`
const listeners = new Set()
let hidden

const notify = () => listeners.forEach((listener) => listener())

const readPreference = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return hidden ?? false
  }
}

const handleStorage = (event) => {
  if (event.key !== null && event.key !== STORAGE_KEY) return
  hidden = readPreference()
  notify()
}

const subscribe = (listener) => {
  if (listeners.size === 0) {
    hidden = readPreference()
    window.addEventListener('storage', handleStorage)
  }
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('storage', handleStorage)
  }
}

const getSnapshot = () => {
  if (hidden === undefined) hidden = readPreference()
  return hidden
}

// Mask balances during server rendering and hydration until the preference is available.
const getServerSnapshot = () => true

export const setBalancePrivacy = (value) => {
  hidden = value
  try {
    localStorage.setItem(STORAGE_KEY, String(value))
  } catch {
    // The toggle still works for this session when browser storage is unavailable.
  }
  notify()
}

export const useBalancePrivacy = () => useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

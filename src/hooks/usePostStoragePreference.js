'use client'

import { useSyncExternalStore } from 'react'

const KEY = `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX ?? 'hup-'}post-storage`
const EVENT = 'hup:post-storage'

export function getPostStoragePreference() {
  try {
    return localStorage.getItem(KEY) === 'hosted' ? 'hosted' : 'ipfs'
  } catch {
    return 'ipfs'
  }
}

export function setPostStoragePreference(mode) {
  localStorage.setItem(KEY, mode === 'hosted' ? 'hosted' : 'ipfs')
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(listener) {
  window.addEventListener('storage', listener)
  window.addEventListener(EVENT, listener)
  return () => {
    window.removeEventListener('storage', listener)
    window.removeEventListener(EVENT, listener)
  }
}

export const usePostStoragePreference = () => useSyncExternalStore(subscribe, getPostStoragePreference, () => 'ipfs')

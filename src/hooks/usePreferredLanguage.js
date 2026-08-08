'use client'

import { useSyncExternalStore } from 'react'
import { DEFAULT_TRANSLATION_LANGUAGE, TRANSLATION_LANGUAGE_CODES } from '@/lib/languageHelper'

const STORAGE_KEY = `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}translation-language`

// Every post in the feed reads this preference, so changing it in Settings has to reach
// all of them at once — it lives in a module store rather than per-component state, the
// same shape useActiveChain uses, which also gets cross-tab sync for free.
const listeners = new Set()
let preferred

const notify = () => listeners.forEach((listener) => listener())

// With no stored choice, the browser's own language is the best guess at what the reader
// actually reads — falling back to the region-less base code ('pt' for 'pt-BR') before English
const readPreference = () => {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && TRANSLATION_LANGUAGE_CODES.includes(stored)) return stored

  const browserLang = navigator.language || ''
  if (TRANSLATION_LANGUAGE_CODES.includes(browserLang)) return browserLang

  const baseLang = browserLang.split('-')[0]
  return TRANSLATION_LANGUAGE_CODES.includes(baseLang) ? baseLang : DEFAULT_TRANSLATION_LANGUAGE
}

const handleStorage = (event) => {
  if (event.key && event.key !== STORAGE_KEY) return
  preferred = readPreference()
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
  if (preferred === undefined) preferred = readPreference()
  return preferred
}

// The choice is browser state, so the server renders against English and React swaps in
// the reader's own language after hydration
const getServerSnapshot = () => DEFAULT_TRANSLATION_LANGUAGE

/**
 * Persist the translation target and wake every post on the page.
 * @param {string} code
 */
export const setPreferredLanguage = (code) => {
  localStorage.setItem(STORAGE_KEY, code)
  preferred = code
  notify()
}

/**
 * The language posts are translated into for this reader.
 * @returns {string} a code from TRANSLATION_LANGUAGE_CODES
 */
export const usePreferredLanguage = () => useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

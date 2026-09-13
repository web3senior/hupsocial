'use client'

import { useCallback, useSyncExternalStore } from 'react'

const STORAGE_KEY = `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}quick-buy-usd`

/** What a one-click buy spends when nobody has chosen, in dollars. */
export const DEFAULT_QUICK_BUY_USD = 5
/** Past this a slip of the finger stops being a trade and starts being an incident. */
export const MAX_QUICK_BUY_USD = 10_000

/** The amounts the settings panel offers, in dollars. */
export const QUICK_BUY_PRESETS = [1, 5, 10, 25, 100]

// The toolbar sets it and every row spends it, so a change has to reach all of them at once: a
// module store rather than per-component state, the same shape useSlippagePreference uses, which
// also gets cross-tab sync for free.
const listeners = new Set()
let preferred

const notify = () => listeners.forEach((listener) => listener())

// This is what a button one press away is authorised to spend, so anything unreadable, zero,
// negative or past the ceiling falls back to the default rather than being trusted
const clamp = (usd) => {
  const value = Number(usd)
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_QUICK_BUY_USD
  return Math.min(value, MAX_QUICK_BUY_USD)
}

// Storage is unavailable in a locked-down browser and throws on access rather than returning
// null, so every touch is guarded — an amount that cannot be remembered still has to work
const readPreference = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === null ? DEFAULT_QUICK_BUY_USD : clamp(stored)
  } catch {
    return DEFAULT_QUICK_BUY_USD
  }
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

// The choice is browser state, so the server renders the default and React swaps the trader's
// own amount in after hydration
const getServerSnapshot = () => DEFAULT_QUICK_BUY_USD

/**
 * Persist what a one-click buy spends, and wake every row on the page.
 * @param {number|string} usd Dollars; clamped before it is written.
 */
export const setQuickBuyAmount = (usd) => {
  const next = clamp(usd)
  try {
    localStorage.setItem(STORAGE_KEY, String(next))
  } catch {
    // Nothing to do: the amount still applies for this session, it just will not outlive it
  }
  preferred = next
  notify()
}

/**
 * The trader's own one-click spend, remembered across reloads and tabs.
 * @returns {[number, Function]} The amount in dollars, and a setter that persists it.
 */
export default function useQuickBuyAmount() {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const choose = useCallback((usd) => setQuickBuyAmount(usd), [])

  return [value, choose]
}

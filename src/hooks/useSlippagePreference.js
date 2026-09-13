'use client'

import { useCallback, useSyncExternalStore } from 'react'

const STORAGE_KEY = `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}max-slippage-bps`

/** 2.5%, the pools.trade default. */
export const DEFAULT_SLIPPAGE_BPS = 250
/** A tolerance past this is almost always a typo, not an intention. */
export const MAX_SLIPPAGE_BPS = 5000

// Every ticket on the page reads this — a feed can hold several — so a change has to reach all of
// them at once: a module store rather than per-component state, the same shape
// useAutoplayPreference uses, which also gets cross-tab sync for free.
const listeners = new Set()
let preferred

const notify = () => listeners.forEach((listener) => listener())

// A tolerance is what a swap is authorised to lose, so anything unreadable, zero, negative or
// past the ceiling falls back to the default rather than being trusted
const clamp = (bps) => {
  const value = Math.round(Number(bps))
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_SLIPPAGE_BPS
  return Math.min(value, MAX_SLIPPAGE_BPS)
}

// Storage is unavailable in a locked-down browser and throws on access rather than returning
// null, so every touch is guarded — a tolerance that cannot be remembered still has to work
const readPreference = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === null ? DEFAULT_SLIPPAGE_BPS : clamp(stored)
  } catch {
    return DEFAULT_SLIPPAGE_BPS
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
// own tolerance in after hydration
const getServerSnapshot = () => DEFAULT_SLIPPAGE_BPS

/**
 * Persist the max slippage a trader is willing to accept, and wake every ticket on the page.
 * @param {number|string} bps Tolerance in basis points; clamped before it is written.
 */
export const setSlippagePreference = (bps) => {
  const next = clamp(bps)
  try {
    localStorage.setItem(STORAGE_KEY, String(next))
  } catch {
    // Nothing to do: the tolerance still applies for this session, it just will not outlive it
  }
  preferred = next
  notify()
}

/**
 * The trader's own max slippage, remembered across reloads and tabs.
 * @returns {[number, Function]} Tolerance in basis points, and a setter that persists it.
 */
export default function useSlippagePreference() {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const choose = useCallback((bps) => setSlippagePreference(bps), [])

  return [value, choose]
}

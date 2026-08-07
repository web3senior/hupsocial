'use client'

// Portfolio state for the profile Assets tab: the cross-chain balance read plus the list of
// token addresses this viewer has pinned for the wallet being looked at.
//
// Pins are local to the browser, not the profile — they only decide what gets probed, and a
// balanceOf probe is public information. Keying them by owner means pinning a token while
// looking at your own profile doesn't leak into someone else's.

import { useCallback, useSyncExternalStore } from 'react'
import { useConfig } from 'wagmi'
import useSWR from 'swr'
import { fetchWalletAssets, normalizeAddress } from '@/lib/walletAssets'

const storageKey = (owner) => `hup:pinned-tokens:${owner.toLowerCase()}`

// Stable empty reference — a fresh [] from getSnapshot would loop useSyncExternalStore forever
const NO_PINS = []

const listeners = new Set()
// getSnapshot has to be pure and referentially stable, so parsed lists are memoised against the
// raw string they came from and only rebuilt when localStorage actually changed
const snapshots = new Map()

const subscribe = (listener) => {
  listeners.add(listener)
  // The storage event covers other tabs; local writes notify through emit()
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

const emit = () => listeners.forEach((listener) => listener())

const parsePins = (raw) => {
  if (!raw) return NO_PINS
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return NO_PINS
    const pins = parsed
      .map((pin) => ({ chainId: Number(pin?.chainId), address: normalizeAddress(pin?.address) }))
      .filter((pin) => pin.address && Number.isFinite(pin.chainId))
    return pins.length ? pins : NO_PINS
  } catch {
    return NO_PINS
  }
}

const getPins = (owner) => {
  if (!owner || typeof window === 'undefined') return NO_PINS
  const key = storageKey(owner)
  let raw = null
  try {
    raw = window.localStorage.getItem(key)
  } catch {
    return NO_PINS
  }
  const cached = snapshots.get(key)
  if (cached && cached.raw === raw) return cached.pins
  const pins = parsePins(raw)
  snapshots.set(key, { raw, pins })
  return pins
}

/**
 * Every non-zero fungible balance held by `owner`, plus pin management.
 *
 * The tab body is conditionally rendered, so an unopened Assets tab never mounts this and costs
 * nothing. SWR handles revalidation — on focus, on reconnect, and on a slow interval — which is
 * why there's no manual refresh control.
 */
export function useWalletAssets(owner) {
  const config = useConfig()
  const holder = normalizeAddress(owner)

  const pins = useSyncExternalStore(
    subscribe,
    () => getPins(holder),
    () => NO_PINS
  )

  const pinKey = pins.map((pin) => `${pin.chainId}:${pin.address}`).join(',')

  const { data, error, isLoading, mutate } = useSWR(
    holder ? ['wallet-assets', holder, pinKey] : null,
    () => fetchWalletAssets(config, holder, pins),
    {
      revalidateOnFocus: true,
      // Balances move without the user doing anything, but nine chains of RPC is not free
      refreshInterval: 60_000,
      keepPreviousData: true,
    }
  )

  const persist = useCallback(
    (next) => {
      if (!holder || typeof window === 'undefined') return
      try {
        window.localStorage.setItem(storageKey(holder), JSON.stringify(next))
      } catch {
        // A full or blocked store just means pins don't survive the reload
      }
      emit()
    },
    [holder]
  )

  const pinToken = useCallback(
    (chainId, address) => {
      const pin = { chainId: Number(chainId), address: normalizeAddress(address) }
      if (!pin.address || !Number.isFinite(pin.chainId)) return
      const current = getPins(holder)
      if (current.some((item) => item.chainId === pin.chainId && item.address === pin.address)) return
      persist([...current, pin])
    },
    [holder, persist]
  )

  const unpinToken = useCallback(
    (chainId, address) => {
      const target = normalizeAddress(address)
      persist(getPins(holder).filter((item) => !(item.chainId === Number(chainId) && item.address === target)))
    },
    [holder, persist]
  )

  return {
    assets: data ?? [],
    isLoading: isLoading && Boolean(holder),
    isError: Boolean(error),
    refresh: mutate,
    pins,
    pinToken,
    unpinToken,
  }
}

export default useWalletAssets

'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { useConnection } from 'wagmi'
import { config, setNetworkColor } from '@/config/wagmi'
import { getActiveChain } from '@/lib/communication'
import { isSolanaNetworkId, solanaChainFor } from '@/config/solana'

const STORAGE_KEY = `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}active-chain`

// Several switchers can sit on the page at once (header + an open dialog), and they
// all read the same disconnected selection — so it lives in a module store rather
// than per-component state, where switching in the header left the dialog stale.
const listeners = new Set()
let selectedId

const notify = () => listeners.forEach((listener) => listener())

// getActiveChain owns the wallet / localStorage / default precedence for the whole
// app; seeding from it keeps the switcher agreeing with everything else onchain.
const readSelection = () => {
  // A Solana pick lives only in localStorage — getActiveChain() knows the wagmi chains alone
  const stored = typeof window === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
  if (stored && isSolanaNetworkId(stored)) return Number(stored)
  return getActiveChain()[0]?.id ?? null
}

const handleStorage = (event) => {
  if (event.key && event.key !== STORAGE_KEY) return
  selectedId = readSelection()
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
  if (selectedId === undefined) selectedId = readSelection()
  return selectedId
}

// The selection is browser state, so the server renders nothing and React swaps in
// the real value after hydration
const getServerSnapshot = () => null

/**
 * Persist the disconnected chain selection and wake every switcher on the page.
 * @param {number} chainId
 */
export const setActiveChainId = (chainId) => {
  localStorage.setItem(STORAGE_KEY, chainId)
  selectedId = chainId
  notify()
}

/**
 * The chain the app is acting on: the wallet's chain when connected, the stored
 * selection otherwise — or the stored Solana cluster whenever that is what was picked.
 * @returns {{chain: object|null, chainId: number|null, isConnected: boolean}}
 */
export const useActiveChain = () => {
  const { isConnected, chain: walletChain } = useConnection()
  const storedId = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  // A Solana selection outranks the EVM wallet's chain: no EVM wallet can switch to Solana, so
  // following the wallet would make Solana unreachable for as long as one is connected
  const chainId = isSolanaNetworkId(storedId) ? storedId : isConnected && walletChain ? walletChain.id : storedId
  const chain = isSolanaNetworkId(chainId) ? solanaChainFor(chainId) : (config.chains.find((item) => item.id === chainId) ?? null)

  useEffect(() => {
    if (chain) setNetworkColor(chain)
  }, [chain?.id])

  return { chain, chainId: chain?.id ?? null, isConnected }
}

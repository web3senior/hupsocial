'use client'

/**
 * @file stores/useSolanaWalletStore.js
 * @description The connected Solana wallet, app-wide. Sits beside wagmi rather than inside it:
 * an EVM wallet and a Solana wallet can both be connected, and each chain's write path asks for
 * its own. Only the wallet's name is remembered (localStorage) so a reload can reconnect
 * silently; the live wallet object and account are never persisted.
 */
import { create } from 'zustand'
import {
  connectSolanaWallet,
  disconnectSolanaWallet,
  listSolanaWallets,
  onSolanaAccountChange,
} from '@/lib/solana/wallet'

const STORAGE_KEY = `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}solana-wallet`

const summarize = (wallet) => ({ name: wallet.name, icon: wallet.icon })

const remember = (name) => {
  try {
    if (name) localStorage.setItem(STORAGE_KEY, name)
    else localStorage.removeItem(STORAGE_KEY)
  } catch (error) {
    // Private mode or blocked storage — the session still works, it just won't auto-reconnect
  }
}

const remembered = () => {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch (error) {
    return null
  }
}

const DISCONNECTED = {
  status: 'disconnected',
  walletName: null,
  address: null,
  account: null,
  wallet: null,
  unsubscribe: null,
}

export const useSolanaWalletStore = create((set, get) => ({
  // Installed wallets, as {name, icon} for the picker
  wallets: [],
  // 'disconnected' | 'connecting' | 'connected'
  status: 'disconnected',
  walletName: null,
  address: null,
  account: null,
  error: null,
  // Live Wallet Standard objects — not serializable, never persisted
  wallet: null,
  unsubscribe: null,

  refreshWallets: () => set({ wallets: listSolanaWallets().map(summarize) }),

  connect: async (name, { silent = false } = {}) => {
    const wallet = listSolanaWallets().find((candidate) => candidate.name === name)
    if (!wallet) throw new Error(`${name} is not installed`)

    set({ status: 'connecting', error: null })

    try {
      const account = await connectSolanaWallet(wallet, { silent })
      if (!account) throw new Error('The wallet shared no Solana account')

      get().unsubscribe?.()
      const unsubscribe = onSolanaAccountChange(wallet, (nextAccount) => {
        if (!nextAccount) {
          get().disconnect()
          return
        }
        set({ account: nextAccount, address: nextAccount.address })
      })

      remember(name)
      set({ status: 'connected', walletName: name, address: account.address, account, wallet, unsubscribe })
      return account
    } catch (error) {
      set({ ...DISCONNECTED, error: error.message })
      throw error
    }
  },

  disconnect: async () => {
    const { wallet, unsubscribe } = get()
    unsubscribe?.()
    remember(null)
    set({ ...DISCONNECTED, error: null })

    try {
      await disconnectSolanaWallet(wallet)
    } catch (error) {
      // The wallet may already consider the session closed
    }
  },

  // Reconnects the remembered wallet without a prompt. Safe to call repeatedly: wallets
  // register asynchronously, so the bootstrap calls it again whenever the registry changes.
  autoConnect: async () => {
    const name = remembered()
    if (!name || get().status !== 'disconnected') return
    if (!listSolanaWallets().some((wallet) => wallet.name === name)) return

    try {
      await get().connect(name, { silent: true })
    } catch (error) {
      // Approval was revoked in the wallet; the user connects again by hand
    }
  },
}))

/**
 * What a write path needs to sign: the live wallet and account, or null when nothing is
 * connected. A plain getter so async flows read the current value, not a stale render's.
 * @returns {{wallet: object, account: object}|null}
 */
export const getSolanaSigner = () => {
  const { wallet, account, status } = useSolanaWalletStore.getState()
  return status === 'connected' && wallet && account ? { wallet, account } : null
}

'use client'

import { useEffect, useRef } from 'react'
import { useSolanaWalletStore } from '@/stores/useSolanaWalletStore'
import { onSolanaWalletsChange } from '@/lib/solana/wallet'
import { ensureProfile } from '@/lib/api'

/**
 * Mounted once under the providers: keeps the installed-wallet list current, reconnects the
 * remembered Solana wallet silently, and gives a freshly connected Solana address its `users`
 * row — the same thing ConnectWallet does for an EVM address. Renders nothing.
 */
export default function SolanaWalletBootstrap() {
  const address = useSolanaWalletStore((state) => state.address)
  const refreshWallets = useSolanaWalletStore((state) => state.refreshWallets)
  const autoConnect = useSolanaWalletStore((state) => state.autoConnect)
  const ensuredRef = useRef(null)

  useEffect(() => {
    // Wallet extensions register on their own schedule, so the reconnect attempt repeats
    // each time the registry changes until the remembered wallet shows up
    const sync = () => {
      refreshWallets()
      autoConnect()
    }

    sync()
    return onSolanaWalletsChange(sync)
  }, [refreshWallets, autoConnect])

  useEffect(() => {
    if (!address || ensuredRef.current === address) return
    ensuredRef.current = address

    ensureProfile(address).catch((error) => {
      console.error('Failed to create Solana user profile:', error.message)
      ensuredRef.current = null
    })
  }, [address])

  return null
}

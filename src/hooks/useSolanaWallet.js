'use client'

import { getSolanaSigner, useSolanaWalletStore } from '@/stores/useSolanaWalletStore'

/**
 * The connected Solana wallet for components — the Solana counterpart of wagmi's
 * `useConnection()`. Selectors are read one by one so a component only re-renders for the
 * field it actually uses.
 * @returns {{
 *   address: string|null, status: string, isConnected: boolean, walletName: string|null,
 *   wallets: Array<{name: string, icon: string}>, error: string|null,
 *   connect: (name: string) => Promise<object>, disconnect: () => Promise<void>,
 *   getSigner: () => ({wallet: object, account: object}|null)
 * }}
 */
export const useSolanaWallet = () => {
  const address = useSolanaWalletStore((state) => state.address)
  const status = useSolanaWalletStore((state) => state.status)
  const walletName = useSolanaWalletStore((state) => state.walletName)
  const wallets = useSolanaWalletStore((state) => state.wallets)
  const error = useSolanaWalletStore((state) => state.error)
  const connect = useSolanaWalletStore((state) => state.connect)
  const disconnect = useSolanaWalletStore((state) => state.disconnect)

  return {
    address,
    status,
    isConnected: status === 'connected' && Boolean(address),
    walletName,
    wallets,
    error,
    connect,
    disconnect,
    getSigner: getSolanaSigner,
  }
}

export default useSolanaWallet

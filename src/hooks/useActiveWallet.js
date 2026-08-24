'use client'

import { useConnection } from 'wagmi'
import { useActiveChain } from '@/hooks/useActiveChain'
import { useSolanaWallet } from '@/hooks/useSolanaWallet'

/**
 * The wallet the app acts and identifies as right now. Identity follows the active network: on
 * a Solana cluster it is the Solana wallet, everywhere else the EVM one — so the header chip,
 * the sidebar profile, notifications and bookmarks all mean the same person the write paths
 * sign as. Both wallets can stay connected underneath; this only decides which one is "you".
 * @returns {{address: string|null, isConnected: boolean, kind: 'evm'|'solana', chain: object|null}}
 */
export const useActiveWallet = () => {
  const { chain } = useActiveChain()
  const evm = useConnection()
  const solana = useSolanaWallet()

  if (chain?.isSolana) {
    return { address: solana.address ?? null, isConnected: solana.isConnected, kind: 'solana', chain }
  }

  return { address: evm.address ?? null, isConnected: Boolean(evm.isConnected && evm.address), kind: 'evm', chain }
}

export default useActiveWallet

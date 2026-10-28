'use client'

import { useConnection } from 'wagmi'

/**
 * The EVM wallet coins act with. Coins live only on EVM chains, and Hup keeps the EVM wallet
 * connected underneath even while a Solana network is active, so this is that connection as is.
 */
export function useEvmWallet() {
  return useConnection()
}

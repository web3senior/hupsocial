'use client'

import { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { config } from './../config/wagmi'
import { announceUpProvider } from '@/lib/upProviderClient'
import SolanaWalletBootstrap from '@/components/SolanaWalletBootstrap'

const queryClient = new QueryClient()

export default function WagmiContext({ children }) {
  // Inside a LUKSO Grid frame this connects to the host and surfaces the visitor's Universal
  // Profile as a discovered wagmi connector; everywhere else it is a no-op
  useEffect(() => {
    announceUpProvider()
  }, [])

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {/* The Solana wallet lives beside wagmi, not inside it — see stores/useSolanaWalletStore */}
        <SolanaWalletBootstrap />
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  )
}

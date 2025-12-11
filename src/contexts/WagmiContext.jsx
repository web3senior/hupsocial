'use client'

// import { config } from '../config/wagmi'

import '@rainbow-me/rainbowkit/styles.css'
import { getDefaultConfig, RainbowKitProvider } from '@rainbow-me/rainbowkit'
import { luksoTestnet } from 'wagmi/chains'
import { WagmiProvider } from 'wagmi'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'

const config = getDefaultConfig({
  appName: 'My RainbowKit App',
  projectId: '1babf4525ab37ef01c97aec81b4cdc35',
  chains: [luksoTestnet],
  // transports: {
  //   [luksoTestnet.id]: http(),
  // },
  ssr: true, // If your dApp uses server side rendering (SSR)
})

const queryClient = new QueryClient()

export default function WagmiContext({ children }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

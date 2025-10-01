import { http, createConfig } from 'wagmi'
import { base, mainnet, optimism, lukso, luksoTestnet } from 'wagmi/chains'
import { injected, metaMask, safe, walletConnect } from 'wagmi/connectors'

const projectId = process.env.NEXT_PUBLIC_PROJECT_ID || ``

export const config = createConfig({
  chains: [mainnet, base, lukso, luksoTestnet],
  connectors: [injected(), walletConnect({ projectId }), metaMask()], //, safe()
  transports: {
    [mainnet.id]: http(),
    [base.id]: http(),
    [lukso.id]: http(),
    [luksoTestnet.id]: http(),
  },
})
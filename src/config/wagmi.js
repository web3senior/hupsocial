import { http, createConfig } from 'wagmi'
import { base,arbitrumGoerli, somniaTestnet, mainnet, optimism, lukso, luksoTestnet } from 'wagmi/chains'
import { injected, metaMask, safe, walletConnect } from 'wagmi/connectors'

const projectId = process.env.NEXT_PUBLIC_PROJECT_ID || ``

export const config = createConfig({
  chains: [luksoTestnet, arbitrumGoerli, somniaTestnet],//mainnet, base, lukso, 
  connectors: [injected(), walletConnect({ projectId }), metaMask()], //, safe()
  transports: {
    [luksoTestnet.id]: http(),
     [arbitrumGoerli.id]: http(),
     [somniaTestnet.id]: http(),
    // [mainnet.id]: http(),
    // [base.id]: http(),
    // [lukso.id]: http(),
  },
})
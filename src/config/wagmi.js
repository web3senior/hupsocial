import { http, createConfig } from 'wagmi'
import { base,arbitrumGoerli, somniaTestnet, mainnet, optimism, lukso, luksoTestnet } from 'wagmi/chains'
import { injected, metaMask, safe, walletConnect } from 'wagmi/connectors'

const projectId = process.env.NEXT_PUBLIC_PROJECT_ID || ``

luksoTestnet.faucetUrl = `https://faucet.testnet.lukso.network/`
luksoTestnet.icon = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><path fill="#F0F3FA" d="M0 0h18v18H0z"/><path d="m9.91 3.27 3.18 2c.56.36.91 1.01.91 1.72V11c0 .71-.35 1.37-.91 1.73l-3.18 2c-.56.36-1.26.36-1.82 0l-3.18-2A2.03 2.03 0 0 1 4 11V7c0-.72.35-1.37.91-1.73l3.18-2a1.69 1.69 0 0 1 1.82 0Zm.3 7.42.72-1.38c.1-.2.1-.43 0-.62l-.73-1.38A.55.55 0 0 0 9.72 7H8.28c-.2 0-.39.12-.48.3l-.73 1.4c-.1.18-.1.42 0 .6l.73 1.4c.1.18.28.3.48.3h1.44c.2 0 .39-.12.48-.3Z" fill="#FE005B"/></svg>`

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
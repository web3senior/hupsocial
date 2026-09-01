import { createConfig, fallback, http, webSocket } from 'wagmi'
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  bsc,
  celo,
  lukso,
  mainnet,
  monad,
  optimismSepolia,
  sepolia,
  somniaTestnet,
  unichainSepolia,
} from 'wagmi/chains'
import { injected, safe, walletConnect } from 'wagmi/connectors'
import { emailWallet } from '@/lib/embeddedWallet/connector'
import { CHAIN_ICONS } from './chainIcons'
import { appChains, CONTRACTS, robinhood } from './contracts'

// Chain data and contract addresses live in config/contracts.js so server code
// can import them without evaluating this module; re-exported here for the
// existing client-side imports.
export { CONTRACTS, robinhood }

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || ``

// Customize chains object
// LUKSO
lukso.faucetUrl = `https://faucet.testnet.lukso.network/`
lukso.primaryColor = `#FD1669`
lukso.textColor = `#fff`

// Base Sepolia
baseSepolia.faucetUrl = `https://faucets.chain.link/base-sepolia`
baseSepolia.primaryColor = `#0052FF`
baseSepolia.textColor = `#fff`

// CELO
celo.faucetUrl = `https://faucet.celo.org/celo-sepolia/`
celo.primaryColor = `#fcff52`
celo.textColor = `#333`

// PulseChain
// pulsechain.icon = `<svg width="35" height="32" viewBox="0 0 35 32" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_12479_3560)"><path d="M34.2857 17.8475C34.2857 18.0114 34.248 18.1671 34.1766 18.3023L26.8239 31.1214C26.5121 31.6651 25.9358 32 25.3121 32H8.97358C8.34993 32 7.77364 31.6651 7.46182 31.1214L0.108451 18.3011C0.0372013 18.1661 0 18.0111 0 17.8475C0 17.3169 0.427308 16.8868 0.95442 16.8868H9.02169L11.0662 20.3823L11.0787 20.4032C11.3515 20.8442 11.9256 20.9879 12.3728 20.7228L12.396 20.7087C12.6022 20.5784 12.7515 20.3735 12.8126 20.1355L15.4177 9.99844L17.6546 26.3186L17.658 26.3413C17.7406 26.8548 18.2159 27.2105 18.7305 27.139L18.7538 27.1354C19.1264 27.0743 19.4291 26.7972 19.524 26.4279L22.6641 14.2091L23.9534 16.4135L23.9662 16.4348C24.1402 16.7154 24.446 16.8868 24.7759 16.8868H33.3313C33.8584 16.8868 34.2857 17.3169 34.2857 17.8475ZM25.3121 0C25.9358 0 26.5121 0.334909 26.8239 0.878569L34.177 13.6983C34.2481 13.8333 34.2857 13.989 34.2857 14.1525C34.2857 14.6831 33.8584 15.1132 33.3313 15.1132H25.2376L23.1931 11.6177L23.1791 11.5944C23.0496 11.3868 22.846 11.2365 22.6097 11.175L22.5875 11.1695C22.0844 11.0511 21.5767 11.3582 21.4467 11.8645L18.8415 22.0015L16.6047 5.68141L16.6012 5.65788C16.5404 5.28284 16.2652 4.97815 15.8983 4.88261C15.388 4.74973 14.8673 5.05843 14.7353 5.57211L11.5951 17.7908L10.3059 15.5865L10.2931 15.5652C10.1191 15.2846 9.81326 15.1132 9.48342 15.1132H0.95442C0.427308 15.1132 0 14.6831 0 14.1525C0 13.9902 0.0362025 13.8368 0.106139 13.7027L7.46182 0.878569C7.77364 0.334909 8.34993 0 8.97358 0H25.3121Z" fill="url(#paint0_linear_12479_3560)"/></g><defs><linearGradient id="paint0_linear_12479_3560" x1="26.1347" y1="2.20695" x2="9.86397" y2="30.7998" gradientUnits="userSpaceOnUse"><stop stop-color="#00EAFF"/><stop offset="0.25" stop-color="#0080FF"/><stop offset="0.5" stop-color="#8000FF"/><stop offset="0.75" stop-color="#E619E6"/><stop offset="1" stop-color="#FF0000"/></linearGradient><clipPath id="clip0_12479_3560"><rect width="34.2857" height="32" fill="white"/></clipPath></defs></svg>`
// pulsechain.primaryColor = `#8000FF`
// pulsechain.textColor = `#fff`

// Base
base.primaryColor = `#0052FF`
base.textColor = `#fff`

// Monad
monad.faucetUrl = `https://faucet.quicknode.com/monad/testnet`
monad.primaryColor = `#836EF9`
monad.textColor = `#fff`

// OptimismSepolia
optimismSepolia.primaryColor = `#FE0420`
optimismSepolia.textColor = `#fff`

// Unichain
unichainSepolia.primaryColor = `#F50DB4`
unichainSepolia.textColor = `#fff`

// Arbitrum
arbitrumSepolia.primaryColor = `#213147`
arbitrumSepolia.textColor = `#12AAFF`

// Somnia
somniaTestnet.primaryColor = `#000`
somniaTestnet.textColor = `#F50947`

// Robinhood
robinhood.primaryColor = `#00C805`
robinhood.textColor = `#fff`
robinhood.isNew = true

// BNB
bsc.primaryColor = `#F0B90B`
bsc.textColor = `#fff`

// Ethereum
mainnet.primaryColor = `#627EEA`
mainnet.textColor = `#fff`

// Sepolia
sepolia.primaryColor = `#627EEA`
sepolia.textColor = `#fff`

arbitrum.primaryColor = `#12AAFF`
arbitrum.textColor = `#fff`

// Polygon
//<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_10991_3429)"><path d="M0 0H18V18H0V0Z" fill="#6C00F6"/><path d="M4 11.56V8.68L6.8 7.19L7.75 7.73V9.03L6.8 8.5L5.25 9.29V10.89L6.8 11.71L8.38 10.89V6.44L11.15 5L14 6.44V9.33L11.16 10.78L10.25 10.25V8.96L11.16 9.47L12.75 8.67V7.1L11.16 6.3L9.62 7.1V11.57L6.8 13L4 11.56Z" fill="white"/></g><defs><clipPath id="clip0_10991_3429"><rect width="18" height="18" fill="white"/></clipPath></defs></svg>

// The logos themselves live in config/chainIcons.js, keyed by chain id, so server code can
// reach one without pulling this module's connectors in with it. Stamped onto the shared chain
// objects here because that is where every client caller already reads them from.
//
// Chain icons render in several places at once (header popover, pages), and
// inline <svg> defs (gradients, clipPaths) collide on duplicate ids across
// instances — a hidden copy breaks visible ones. Expose each icon as a
// data-URI so <img> renders it in its own isolated SVG document.
const iconChains = [
  mainnet,
  sepolia,
  lukso,
  baseSepolia,
  celo,
  base,
  monad,
  optimismSepolia,
  unichainSepolia,
  arbitrum,
  arbitrumSepolia,
  somniaTestnet,
  robinhood,
  bsc,
]
iconChains.forEach((chain) => {
  chain.icon = CHAIN_ICONS[chain.id]
  chain.iconUrl = `data:image/svg+xml,${encodeURIComponent(chain.icon)}`
})

// Browser-side RPC order per chain. Anything building its own viem client must use this too,
// so wagmi and ad-hoc clients never disagree on which endpoint is rate-limited.
// Chains absent here use viem's default.
export const BROWSER_RPC_URLS = {
  // viem's default (eth.merkle.io) sends no CORS headers
  [mainnet.id]: ['https://ethereum-rpc.publicnode.com'],
  // Reverse of the server order in config/contracts: the official node passes CORS and has no
  // keyless cap in browsers; thirdweb rate-limits busy pages with -32005
  [lukso.id]: ['https://rpc.mainnet.lukso.network', 'https://42.rpc.thirdweb.com'],
  // The official endpoint sends a malformed Access-Control-Allow-Origin ('*,*')
  [robinhood.id]: ['https://robinhood-rpc.publicnode.com'],
  // sepolia.base.org is unreliable; publicnode leads
  [baseSepolia.id]: ['https://base-sepolia-rpc.publicnode.com', 'https://sepolia.base.org'],
}

/** Fails over across the chain's known-good endpoints; viem's default where there are none. */
export const browserTransport = (chainId) => {
  const urls = BROWSER_RPC_URLS[chainId]
  return urls?.length ? fallback(urls.map((url) => http(url))) : http()
}

export const config = createConfig({
  chains: appChains,
  // WalletConnect's provider touches browser-only storage (indexedDB) the
  // moment it is constructed, and this module also evaluates on the server
  // (SSR and any API route reaching wagmi through an import chain) — so
  // connectors only exist in the browser.
  connectors: typeof window === 'undefined' ? [] : [injected(), walletConnect({ projectId }), safe(), emailWallet()],
  transports: Object.fromEntries(appChains.map((chain) => [chain.id, browserTransport(chain.id)])),
  ssr: true,
  // storage: createStorage({
  //   storage: noopStorage, // <-- Tell wagmi to use a no-op storage on the server
  // }),
})

/**
 * Set network colors
 * @param {json} chain
 */
export const setNetworkColor = (chain) => {
  const rootElement = document.documentElement
  rootElement.style.setProperty(`--network-color-primary`, chain.primaryColor)
  rootElement.style.setProperty(`--network-color-text`, chain.textColor)
}

/**
 * Get network colors
 * @param {json} chain
 */
export const getNetworkColor = () => {
  const rootElement = document.documentElement
  const primaryColor = rootElement.style.getPropertyValue(`--network-color-primary`)
  const secondaryColor = rootElement.style.getPropertyValue(`--network-color-text`)
  return { primaryColor, secondaryColor }
}

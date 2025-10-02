import { http, createConfig } from 'wagmi'
import { base, baseGoerli, celoSepolia, lineaGoerli, arbitrumGoerli, somniaTestnet, mainnet, optimism, lukso, luksoTestnet } from 'wagmi/chains'
import { injected, metaMask, safe, walletConnect } from 'wagmi/connectors'

const projectId = process.env.NEXT_PUBLIC_PROJECT_ID || ``

luksoTestnet.faucetUrl = `https://faucet.testnet.lukso.network/`
luksoTestnet.icon = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"> <g clip-path="url(#clip0_10688_3589)"> <path d="M0 0H18V18H0V0Z" fill="#F0F3FA"/> <path d="M9.91014 4.22168L13.09 5.88891C13.65 6.18901 14 6.73086 14 7.32273V10.6655C14 11.2574 13.65 11.8076 13.09 12.1077L9.91014 13.7749C9.35015 14.075 8.65018 14.075 8.0902 13.7749L4.9103 12.1077C4.62528 11.9506 4.39245 11.736 4.23338 11.4839C4.07431 11.2318 3.99415 10.9503 4.00033 10.6655V7.33107C4.00033 6.73086 4.35032 6.18901 4.9103 5.88891L8.0902 4.22168C8.36194 4.07692 8.67768 4 9.00017 4C9.32265 4 9.6384 4.07692 9.91014 4.22168ZM10.2101 10.4071L10.9301 9.25672C11.0301 9.09 11.0301 8.89827 10.9301 8.73988L10.2001 7.58949C10.1562 7.51389 10.0882 7.44981 10.0035 7.40424C9.9189 7.35866 9.82087 7.33335 9.72014 7.33107H8.28019C8.0802 7.33107 7.8902 7.4311 7.80021 7.58115L7.07023 8.74821C6.97023 8.89827 6.97023 9.09833 7.07023 9.24838L7.80021 10.4154C7.9002 10.5655 8.0802 10.6655 8.28019 10.6655H9.72014C9.92014 10.6655 10.1101 10.5655 10.2001 10.4154L10.2101 10.4071Z" fill="#FE005B"/> </g> <defs> <clipPath id="clip0_10688_3589"> <rect width="18" height="18" fill="white"/> </clipPath> </defs> </svg>`

export const config = createConfig({
  chains: [luksoTestnet, arbitrumGoerli,celoSepolia, baseGoerli, lineaGoerli, somniaTestnet], //mainnet, base, lukso,
  connectors: [injected(), walletConnect({ projectId }), metaMask()], //, safe()
  transports: {
    [luksoTestnet.id]: http(),
    //  [arbitrumGoerli.id]: http(),
    //  [somniaTestnet.id]: http(),
    // [mainnet.id]: http(),
    // [base.id]: http(),
    // [lukso.id]: http(),
  },
})

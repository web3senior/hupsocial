import { createConfig, http, webSocket } from 'wagmi'
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
import { appChains, CONTRACTS, robinhood } from './contracts'

// Chain data and contract addresses live in config/contracts.js so server code
// can import them without evaluating this module; re-exported here for the
// existing client-side imports.
export { CONTRACTS, robinhood }

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || ``

// Customize chains object
// LUKSO
lukso.icon = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_12569_3554)"><path d="M27.6553 6.05588L18.3339 0.712379C16.6833 -0.23746 14.6428 -0.23746 12.9922 0.712379L3.67087 6.05588C2.02027 7.00572 1 8.75682 1 10.6512V21.3435C1 23.2379 2.02027 24.989 3.67087 25.9388L12.9922 31.2876C14.6428 32.2375 16.6833 32.2375 18.3339 31.2876L27.6553 25.9388C29.3059 24.989 30.3261 23.2379 30.3261 21.3435V10.6512C30.3261 8.75682 29.3112 7.00572 27.6553 6.05588ZM23.0614 17.0613L20.289 21.8317C19.9097 22.4897 19.2046 22.893 18.4408 22.893H12.8907C12.1268 22.893 11.4217 22.4897 11.0425 21.8317L8.26476 17.0613C7.8855 16.4033 7.8855 15.5967 8.26476 14.9387L11.0371 10.1683C11.4164 9.51032 12.1215 9.10704 12.8854 9.10704H18.4301C19.1939 9.10704 19.8991 9.51032 20.2783 10.1683L23.0507 14.9387C23.4406 15.5967 23.4406 16.4033 23.0614 17.0613Z" fill="#FE005B"/></g><defs><clipPath id="clip0_12569_3554"><rect width="32" height="32" fill="white"/></clipPath></defs></svg>`
lukso.faucetUrl = `https://faucet.testnet.lukso.network/`
lukso.primaryColor = `#FD1669`
lukso.textColor = `#fff`

// CELO
celo.icon = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_12476_3608)"><path d="M28 0H4C1.79086 0 0 1.79086 0 4V28C0 30.2091 1.79086 32 4 32H28C30.2091 32 32 30.2091 32 28V4C32 1.79086 30.2091 0 28 0Z" fill="#FCFF52"/><path fill-rule="evenodd" clip-rule="evenodd" d="M23.9989 24H8V8H24V13.5853H21.345C20.4298 11.5473 18.3696 10.1289 16.012 10.1289C12.7621 10.1289 10.13 12.784 10.13 16.0108C10.13 19.2388 12.7621 21.8711 16.012 21.8711C18.4154 21.8711 20.4756 20.4061 21.3907 18.3238H24V24H23.9989Z" fill="black"/></g><defs><clipPath id="clip0_12476_3608"><rect width="32" height="32" fill="white"/></clipPath></defs></svg>`
celo.faucetUrl = `https://faucet.celo.org/celo-sepolia/`
celo.primaryColor = `#fcff52`
celo.textColor = `#333`

// PulseChain
// pulsechain.icon = `<svg width="35" height="32" viewBox="0 0 35 32" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_12479_3560)"><path d="M34.2857 17.8475C34.2857 18.0114 34.248 18.1671 34.1766 18.3023L26.8239 31.1214C26.5121 31.6651 25.9358 32 25.3121 32H8.97358C8.34993 32 7.77364 31.6651 7.46182 31.1214L0.108451 18.3011C0.0372013 18.1661 0 18.0111 0 17.8475C0 17.3169 0.427308 16.8868 0.95442 16.8868H9.02169L11.0662 20.3823L11.0787 20.4032C11.3515 20.8442 11.9256 20.9879 12.3728 20.7228L12.396 20.7087C12.6022 20.5784 12.7515 20.3735 12.8126 20.1355L15.4177 9.99844L17.6546 26.3186L17.658 26.3413C17.7406 26.8548 18.2159 27.2105 18.7305 27.139L18.7538 27.1354C19.1264 27.0743 19.4291 26.7972 19.524 26.4279L22.6641 14.2091L23.9534 16.4135L23.9662 16.4348C24.1402 16.7154 24.446 16.8868 24.7759 16.8868H33.3313C33.8584 16.8868 34.2857 17.3169 34.2857 17.8475ZM25.3121 0C25.9358 0 26.5121 0.334909 26.8239 0.878569L34.177 13.6983C34.2481 13.8333 34.2857 13.989 34.2857 14.1525C34.2857 14.6831 33.8584 15.1132 33.3313 15.1132H25.2376L23.1931 11.6177L23.1791 11.5944C23.0496 11.3868 22.846 11.2365 22.6097 11.175L22.5875 11.1695C22.0844 11.0511 21.5767 11.3582 21.4467 11.8645L18.8415 22.0015L16.6047 5.68141L16.6012 5.65788C16.5404 5.28284 16.2652 4.97815 15.8983 4.88261C15.388 4.74973 14.8673 5.05843 14.7353 5.57211L11.5951 17.7908L10.3059 15.5865L10.2931 15.5652C10.1191 15.2846 9.81326 15.1132 9.48342 15.1132H0.95442C0.427308 15.1132 0 14.6831 0 14.1525C0 13.9902 0.0362025 13.8368 0.106139 13.7027L7.46182 0.878569C7.77364 0.334909 8.34993 0 8.97358 0H25.3121Z" fill="url(#paint0_linear_12479_3560)"/></g><defs><linearGradient id="paint0_linear_12479_3560" x1="26.1347" y1="2.20695" x2="9.86397" y2="30.7998" gradientUnits="userSpaceOnUse"><stop stop-color="#00EAFF"/><stop offset="0.25" stop-color="#0080FF"/><stop offset="0.5" stop-color="#8000FF"/><stop offset="0.75" stop-color="#E619E6"/><stop offset="1" stop-color="#FF0000"/></linearGradient><clipPath id="clip0_12479_3560"><rect width="34.2857" height="32" fill="white"/></clipPath></defs></svg>`
// pulsechain.primaryColor = `#8000FF`
// pulsechain.textColor = `#fff`

// Base
base.icon = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_12476_3596)"><path d="M28 0H4C1.79086 0 0 1.79086 0 4V28C0 30.2091 1.79086 32 4 32H28C30.2091 32 32 30.2091 32 28V4C32 1.79086 30.2091 0 28 0Z" fill="#0052FF"/><path fill-rule="evenodd" clip-rule="evenodd" d="M15.9832 26C21.5061 26 25.9832 21.5229 25.9832 16C25.9832 10.4772 21.5061 6 15.9832 6C10.7438 6 6.44544 10.0294 6.01808 15.1585H20.8574V16.8237H6.0166C6.43544 21.9612 10.7376 26 15.9832 26Z" fill="white"/></g><defs><clipPath id="clip0_12476_3596"><rect width="32" height="32" fill="white"/></clipPath></defs></svg>`
base.primaryColor = `#0052FF`
base.textColor = `#fff`

// Monad
monad.icon = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_12476_3588)"><path d="M28 0H4C1.79086 0 0 1.79086 0 4V28C0 30.2091 1.79086 32 4 32H28C30.2091 32 32 30.2091 32 28V4C32 1.79086 30.2091 0 28 0Z" fill="#836EF9"/><path d="M16 6C13.1122 6 6 13.112 6 15.9999C6 18.8879 13.1122 26 16 26C18.8877 26 26 18.8877 26 15.9999C26 13.1121 18.8878 6 16 6ZM14.4416 21.7183C13.2239 21.3864 9.94988 15.6593 10.2818 14.4416C10.6137 13.2238 16.3406 9.94986 17.5583 10.2817C18.7761 10.6136 22.0502 16.3405 21.7183 17.5583C21.3864 18.7762 15.6594 22.0502 14.4416 21.7183Z" fill="#FEFEFE"/></g><defs><clipPath id="clip0_12476_3588"><rect width="32" height="32" fill="white"/></clipPath></defs></svg>`
monad.faucetUrl = `https://faucet.quicknode.com/monad/testnet`
monad.primaryColor = `#836EF9`
monad.textColor = `#fff`

// Base Sepolia
baseSepolia.icon = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_12582_3557)"><path d="M28 0H4C1.79086 0 0 1.79086 0 4V28C0 30.2091 1.79086 32 4 32H28C30.2091 32 32 30.2091 32 28V4C32 1.79086 30.2091 0 28 0Z" fill="#9A9C9F"/><path fill-rule="evenodd" clip-rule="evenodd" d="M15.9832 26C21.5061 26 25.9832 21.5229 25.9832 16C25.9832 10.4772 21.5061 6 15.9832 6C10.7438 6 6.44544 10.0294 6.01808 15.1585H20.8574V16.8237H6.0166C6.43544 21.9612 10.7376 26 15.9832 26Z" fill="white"/></g><defs><clipPath id="clip0_12582_3557"><rect width="32" height="32" fill="white"/></clipPath></defs></svg>`
baseSepolia.faucetUrl = `https://faucets.chain.link/base-sepolia`
baseSepolia.primaryColor = `#0052FF`
baseSepolia.textColor = `#fff`

// OptimismSepolia
optimismSepolia.icon = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_10964_3437)"><path d="M18 0H0V18H18V0Z" fill="#FE0420"/><path fill-rule="evenodd" clip-rule="evenodd" d="M3.64398 11.5333C4.07903 11.8444 4.63715 12 5.31834 12C6.14264 12 6.80091 11.8139 7.29322 11.4417C7.78551 11.0639 8.13181 10.4944 8.33218 9.73332C8.45238 9.26667 8.55541 8.78611 8.6413 8.29167C8.66992 8.11389 8.68421 7.96667 8.68421 7.85C8.68421 7.46111 8.58403 7.12778 8.38369 6.85C8.18333 6.56667 7.90858 6.35556 7.5594 6.21667C7.21021 6.07222 6.81524 6 6.37447 6C4.75449 6 3.74988 6.76389 3.36063 8.29167C3.22325 8.85278 3.11735 9.33333 3.04293 9.73332C3.01431 9.9111 3 10.0611 3 10.1833C3 10.7667 3.21466 11.2167 3.64398 11.5333ZM6.74367 9.68334C6.5793 10.3215 6.12578 10.7368 5.43855 10.7368C4.75869 10.7368 4.52622 10.2771 4.64859 9.68334C4.75163 9.14445 4.85467 8.68889 4.95771 8.31667C5.13523 7.62748 5.55191 7.26316 6.26284 7.26316C6.93965 7.26316 7.16201 7.71644 7.04422 8.31667C6.9755 8.70556 6.87535 9.1611 6.74367 9.68334ZM9.34562 11.94C9.37902 11.98 9.42633 12 9.48761 12H10.6235C10.6792 12 10.732 11.98 10.7822 11.94C10.8323 11.9 10.8629 11.8486 10.874 11.7857L11.2693 10H12.425C13.1544 10 13.6887 9.75144 14.1063 9.43716C14.5295 9.12285 14.8107 8.63714 14.9499 7.98C14.9833 7.82571 15 7.67714 15 7.53429C15 7.03714 14.8107 6.65714 14.432 6.39429C14.059 6.13143 13.5634 6 12.9453 6H10.7237C10.668 6 10.6151 6.02 10.565 6.06C10.5149 6.1 10.4843 6.15143 10.4731 6.21429L9.32055 11.7857C9.30941 11.8429 9.31778 11.8943 9.34562 11.94ZM13.4047 7.96286C13.3008 8.4217 12.9369 8.74352 12.4671 8.74352H11.5066L11.8011 7.26316H12.8034C13.1446 7.26316 13.4298 7.33041 13.4298 7.70571C13.4298 7.78 13.4214 7.86571 13.4047 7.96286Z" fill="white"/></g><defs><clipPath id="clip0_10964_3437"><rect width="18" height="18" fill="white"/></clipPath></defs></svg>`
optimismSepolia.primaryColor = `#FE0420`
optimismSepolia.textColor = `#fff`

// Unichain
unichainSepolia.icon = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_10964_3441)"><path d="M18 0H0V18H18V0Z" fill="#F50DB4"/><path d="M14.9742 8.88585C11.729 8.88585 9.10099 6.24956 9.10099 3H8.87318V8.88585H3V9.11415C6.24521 9.11415 8.87318 11.7505 8.87318 15H9.10099V9.11415H14.9742V8.88585Z" fill="white"/></g><defs><clipPath id="clip0_10964_3441"><rect width="18" height="18" fill="white"/></clipPath></defs></svg>`
unichainSepolia.primaryColor = `#F50DB4`
unichainSepolia.textColor = `#fff`

// Arbitrum
arbitrumSepolia.icon = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"> <g clip-path="url(#clip0_10733_2639)"> <path d="M0 0H18V18H0V0Z" fill="#213147"/> <path d="M9.84015 9.91092L9.29015 11.5109C9.27568 11.553 9.27568 11.5988 9.29015 11.6409L10.2302 14.3809L11.3202 13.7209L10.0202 9.92092C10.012 9.90401 9.99918 9.88975 9.98326 9.87977C9.96735 9.8698 9.94894 9.8645 9.93015 9.8645C9.91137 9.8645 9.89296 9.8698 9.87705 9.87977C9.86113 9.88975 9.84834 9.90401 9.84015 9.92092V9.91092ZM10.9302 7.23092C10.9212 7.21644 10.9087 7.2045 10.8938 7.19622C10.8789 7.18794 10.8622 7.18359 10.8452 7.18359C10.8281 7.18359 10.8114 7.18794 10.7965 7.19622C10.7816 7.2045 10.7691 7.21644 10.7602 7.23092L10.2102 8.83092C10.1957 8.87304 10.1957 8.91879 10.2102 8.96092L11.7502 13.4609L12.8402 12.7809L10.9402 7.23092H10.9302Z" fill="#12AAFF"/> <path d="M9 3.67C9.03 3.67 9.05 3.67 9.08 3.69L13.3 6.31C13.35 6.34 13.38 6.39 13.38 6.45V11.55C13.38 11.6 13.35 11.65 13.3 11.69L9.08 14.3C9.05605 14.3151 9.02831 14.3231 9 14.3231C8.97169 14.3231 8.94395 14.3151 8.92 14.3L4.7 11.7C4.67612 11.6851 4.65631 11.6645 4.64235 11.6401C4.62838 11.6157 4.62071 11.5881 4.62 11.56V6.46C4.62 6.4 4.65 6.36 4.7 6.32L8.92 3.7C8.94289 3.68191 8.97086 3.67142 9 3.67ZM9 3C8.85 3 8.7 3.04 8.57 3.12L4.43 5.67C4.29815 5.75297 4.18953 5.86807 4.11432 6.0045C4.03911 6.14092 3.99977 6.29421 4 6.45V11.55C4 11.87 4.16 12.17 4.43 12.33L8.57 14.88C8.69889 14.9607 8.84791 15.0036 9 15.0036C9.15209 15.0036 9.30111 14.9607 9.43 14.88L13.57 12.33C13.7033 12.2461 13.8128 12.1295 13.8881 11.9911C13.9634 11.8528 14.0019 11.6975 14 11.54V6.45C13.9993 6.29439 13.9596 6.14145 13.8844 6.00518C13.8093 5.8689 13.7012 5.75366 13.57 5.67L9.43 3.12C9.30032 3.04148 9.1516 2.99998 9 3Z" fill="#9DCCED"/> <path d="M6.25977 13.4596L6.63977 12.3496L7.40977 13.0196L6.68977 13.7196L6.25977 13.4596Z" fill="#213147"/> <path d="M8.64992 6H7.59992C7.56099 6.00414 7.52414 6.01961 7.49392 6.04449C7.4637 6.06938 7.44145 6.10259 7.42992 6.14L5.16992 12.78L6.25992 13.46L8.73992 6.14C8.75992 6.07 8.71992 6 8.64992 6ZM10.4999 6H9.42992C9.39181 6.00208 9.3552 6.0156 9.32488 6.03879C9.29455 6.06198 9.27192 6.09376 9.25992 6.13L6.67992 13.71L7.76992 14.39L10.5699 6.14C10.5899 6.07 10.5499 6 10.4799 6H10.4999Z" fill="white"/> </g> <defs> <clipPath id="clip0_10733_2639"> <rect width="18" height="18" fill="white"/> </clipPath> </defs> </svg>`
arbitrumSepolia.primaryColor = `#213147`
arbitrumSepolia.textColor = `#12AAFF`

// Somnia
somniaTestnet.icon = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"> <g clip-path="url(#clip0_10733_2635)"> <path d="M0 0H18V18H0V0Z" fill="url(#paint0_linear_10733_2635)"/> <path d="M13.4802 6.78073V6.79073L13.0302 6.94073C12.501 7.0614 11.9522 7.06822 11.4202 6.96073C10.4902 6.76073 9.74021 6.26073 9.18021 5.46073C9.17041 5.44338 9.15566 5.42936 9.13785 5.42045C9.12003 5.41154 9.09996 5.40816 9.08021 5.41073C9.03021 5.41073 9.00021 5.44073 9.00021 5.48073C8.96934 6.76104 8.46437 7.98433 7.58312 8.91361C6.70187 9.84289 5.50708 10.412 4.23021 10.5107C3.91998 9.54256 3.91477 8.50245 4.21526 7.53121C4.51575 6.55998 5.10744 5.70455 5.91021 5.08073C6.60108 4.52788 7.42801 4.17116 8.30424 4.04799C9.18047 3.92483 10.0737 4.03976 10.8902 4.38073C12.0208 4.8327 12.9436 5.68781 13.4802 6.78073Z" fill="url(#paint1_linear_10733_2635)"/> <path d="M4.51989 11.2202C4.51902 11.2187 4.51855 11.217 4.51855 11.2152C4.51855 11.2135 4.51902 11.2118 4.51989 11.2102H4.52989L4.96989 11.0702C5.49833 10.9459 6.04719 10.9357 6.57989 11.0402C7.50989 11.2402 8.25989 11.7402 8.81989 12.5402C8.82969 12.5576 8.84444 12.5716 8.86225 12.5805C8.88007 12.5894 8.90014 12.5928 8.91989 12.5902C8.96989 12.5902 8.99989 12.5602 8.99989 12.5202C9.03076 11.2399 9.53574 10.0166 10.417 9.08735C11.2982 8.15807 12.493 7.58895 13.7699 7.49023C14.0801 8.4584 14.0853 9.49852 13.7848 10.4697C13.4844 11.441 12.8927 12.2964 12.0899 12.9202C11.399 13.4731 10.5721 13.8298 9.69586 13.953C8.81963 14.0761 7.9264 13.9612 7.10989 13.6202C5.97934 13.1683 5.05652 12.3131 4.51989 11.2202Z" fill="url(#paint2_linear_10733_2635)"/> </g> <defs> <linearGradient id="paint0_linear_10733_2635" x1="3.35" y1="3.12" x2="21.9" y2="24.43" gradientUnits="userSpaceOnUse"> <stop stop-color="#1A1E21"/> <stop offset="1" stop-color="#06060A"/> </linearGradient> <linearGradient id="paint1_linear_10733_2635" x1="12.1202" y1="3.65073" x2="6.86021" y2="10.1807" gradientUnits="userSpaceOnUse"> <stop stop-color="#2F28F1"/> <stop offset="0.65" stop-color="#3FC4ED"/> <stop offset="1" stop-color="#44C0EE"/> </linearGradient> <linearGradient id="paint2_linear_10733_2635" x1="13.9999" y1="9.57023" x2="6.99989" y2="14.6902" gradientUnits="userSpaceOnUse"> <stop stop-color="#F50947"/> <stop offset="1" stop-color="#4D6CF3"/> </linearGradient> <clipPath id="clip0_10733_2635"> <rect width="18" height="18" fill="white"/> </clipPath> </defs> </svg>`
somniaTestnet.primaryColor = `#000`
somniaTestnet.textColor = `#F50947`

// Robinhood
robinhood.icon = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_12476_3591)"><path d="M0 4C0 1.79086 1.79086 0 4 0H28C30.2091 0 32 1.79086 32 4V28C32 30.2091 30.2091 32 28 32H4C1.79086 32 0 30.2091 0 28V4Z" fill="#CCFF00"/><path d="M17.9177 11.0605H14.2823C14.1508 11.0605 14.0312 11.1087 13.9475 11.2291L11.3405 14.4794C10.9579 14.9609 10.8622 15.4063 10.8622 16.0443V19.3669C10.0132 21.7624 9.47504 23.3876 9.08041 24.8562C9.04454 24.9525 9.09237 25.0007 9.17608 25.0007H9.57071C9.64245 25.0007 9.70225 24.9646 9.73812 24.9044C12.7158 17.2722 15.9565 13.4922 17.9894 11.2291C18.0731 11.1328 18.0373 11.0605 17.9177 11.0605Z" fill="#1C180D"/><path d="M18.0269 7.31628C17.7997 7.42462 17.6801 7.4487 17.4409 7.66538C16.3647 8.59232 15.6472 9.32665 14.9655 10.0489C14.8818 10.1332 14.9177 10.2175 15.0373 10.2175H19.0673C19.438 10.2175 19.6532 10.4342 19.6532 10.8073V15.3818C19.6532 15.5022 19.7489 15.5383 19.8206 15.43L22.2482 12.2399C22.6428 11.7222 22.7624 11.5657 22.87 10.8434C23.0135 9.78408 22.9298 8.15895 22.296 7.48481C21.734 6.88291 19.1988 6.85883 18.0269 7.31628Z" fill="#1C180D"/><path d="M18.6352 11.9751C16.1359 14.78 14.1866 17.7293 12.3809 21.2806C12.3331 21.3769 12.3929 21.4491 12.5005 21.413L16.2315 20.2573C16.6501 20.149 16.8892 19.9564 17.0925 19.6193L18.7548 16.8626C18.7906 16.7903 18.8026 16.7061 18.8026 16.6459V12.0473C18.8026 11.9269 18.7189 11.8788 18.6352 11.9751Z" fill="#1C180D"/></g><defs><clipPath id="clip0_12476_3591"><rect width="32" height="32" fill="white"/></clipPath></defs></svg>`
robinhood.primaryColor = `#00C805`
robinhood.textColor = `#fff`
robinhood.isNew = true

// BNB
bsc.icon = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_12476_3599)"><path d="M28 0H4C1.79086 0 0 1.79086 0 4V28C0 30.2091 1.79086 32 4 32H28C30.2091 32 32 30.2091 32 28V4C32 1.79086 30.2091 0 28 0Z" fill="#F0B90B"/><path d="M9.41131 16.0002L9.42186 19.8686L12.7088 21.8028V24.0675L7.49824 21.0115V14.8691L9.41131 16.0002ZM9.41131 12.1319V14.3861L7.49707 13.2537V10.9995L9.41131 9.86719L11.3349 10.9995L9.41131 12.1319ZM14.0815 10.9995L15.9957 9.86719L17.9193 10.9995L15.9957 12.1319L14.0815 10.9995Z" fill="white"/><path d="M10.7939 19.0668V16.8021L12.7082 17.9344V20.1886L10.7939 19.0668ZM14.0809 22.6139L15.9951 23.7463L17.9187 22.6139V24.8681L15.9951 26.0005L14.0809 24.8681V22.6139ZM20.6641 10.9995L22.5783 9.86719L24.5019 10.9995V13.2537L22.5783 14.3861V12.1319L20.6641 10.9995ZM22.5783 19.8686L22.5889 16.0002L24.5031 14.8679V21.0103L19.2926 24.0663V21.8016L22.5783 19.8686Z" fill="white"/><path d="M21.2053 19.0675L19.291 20.1893V17.9351L21.2053 16.8027V19.0675Z" fill="white"/><path d="M21.2056 12.9337L21.2162 15.1984L17.9199 17.1326V21.0103L16.0057 22.1322L14.0914 21.0103V17.1326L10.7951 15.1984V12.9337L12.7176 11.8013L15.9939 13.7449L19.2902 11.8013L21.2139 12.9337H21.2056ZM10.7939 9.06654L15.9951 6L21.2056 9.06654L19.2914 10.1989L15.9951 8.25536L12.7082 10.1989L10.7939 9.06654Z" fill="white"/></g><defs><clipPath id="clip0_12476_3599"><rect width="32" height="32" fill="white"/></clipPath></defs></svg>`
bsc.primaryColor = `#F0B90B`
bsc.textColor = `#fff`

// Ethereum
mainnet.icon = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_12476_3562)"><path d="M28 0H4C1.79086 0 0 1.79086 0 4V28C0 30.2091 1.79086 32 4 32H28C30.2091 32 32 30.2091 32 28V4C32 1.79086 30.2091 0 28 0Z" fill="#627EEA"/><path d="M15.998 6V13.3933L22.2469 16.1856L15.998 6Z" fill="white" fill-opacity="0.602"/><path d="M15.9989 6L9.74902 16.1856L15.9989 13.3933V6Z" fill="white"/><path d="M15.998 20.9771V26.0009L22.2511 17.3496L15.998 20.9771Z" fill="white" fill-opacity="0.602"/><path d="M15.9989 26.0009V20.9763L9.74902 17.3496L15.9989 26.0009Z" fill="white"/><path d="M15.998 19.8135L22.2469 16.1852L15.998 13.3945V19.8135Z" fill="white" fill-opacity="0.2"/><path d="M9.74902 16.1852L15.9989 19.8135V13.3945L9.74902 16.1852Z" fill="white" fill-opacity="0.602"/></g><defs><clipPath id="clip0_12476_3562"><rect width="32" height="32" fill="white"/></clipPath></defs></svg>`
mainnet.primaryColor = `#627EEA`
mainnet.textColor = `#fff`

// Sepolia
sepolia.icon = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_10996_4352)"><path d="M18 0H0V18H18V0Z" fill="#627EEA"/><mask id="mask0_10996_4352" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="1" y="1" width="16" height="16"><path d="M16.5 1.5H1.5V16.5H16.5V1.5Z" fill="white"/></mask><g mask="url(#mask0_10996_4352)"><path d="M9 16.5C13.1421 16.5 16.5 13.1421 16.5 9C16.5 4.85787 13.1421 1.5 9 1.5C4.85787 1.5 1.5 4.85787 1.5 9C1.5 13.1421 4.85787 16.5 9 16.5Z" fill="#627EEA"/><path d="M9.2334 3.375V7.5328L12.7476 9.1031L9.2334 3.375Z" fill="white" fill-opacity="0.602"/><path d="M9.23345 3.375L5.71875 9.1031L9.23345 7.5328V3.375Z" fill="white"/><path d="M9.2334 11.7978V14.623L12.7499 9.75781L9.2334 11.7978Z" fill="white" fill-opacity="0.602"/><path d="M9.23345 14.623V11.7974L5.71875 9.75781L9.23345 14.623Z" fill="white"/><path d="M9.2334 11.1431L12.7476 9.10255L9.2334 7.5332V11.1431Z" fill="white" fill-opacity="0.2"/><path d="M5.71875 9.10255L9.23345 11.1431V7.5332L5.71875 9.10255Z" fill="white" fill-opacity="0.602"/></g></g><defs><clipPath id="clip0_10996_4352"><rect width="18" height="18" fill="white"/></clipPath></defs></svg>`
sepolia.primaryColor = `#627EEA`
sepolia.textColor = `#fff`

arbitrum.icon = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_12476_3620)"><path d="M28 0H4C1.79086 0 0 1.79086 0 4V28C0 30.2091 1.79086 32 4 32H28C30.2091 32 32 30.2091 32 28V4C32 1.79086 30.2091 0 28 0Z" fill="#213147"/><path d="M18.2528 15.1635L19.7216 12.6712L23.6805 18.8374L23.6824 20.0208L23.6695 11.8777C23.6601 11.6787 23.5544 11.4966 23.3858 11.3892L16.2582 7.28933C16.0916 7.20735 15.88 7.2083 15.7136 7.29193C15.6911 7.30313 15.6699 7.31541 15.6498 7.3288L15.6249 7.34441L8.70652 11.3535L8.67971 11.3657C8.64519 11.3816 8.61026 11.4018 8.57755 11.4252C8.44634 11.5193 8.35926 11.6584 8.33108 11.8144C8.32684 11.8381 8.32371 11.8621 8.32227 11.8865L8.33314 18.5222L12.0207 12.8067C12.485 12.0488 13.4965 11.8047 14.4355 11.818L15.5376 11.847L9.04387 22.2612L9.80935 22.7018L16.3808 11.8576L19.2855 11.8471L12.7309 22.9649L15.4624 24.536L15.7887 24.7237C15.9268 24.7798 16.0895 24.7827 16.2287 24.7324L23.4565 20.5438L22.0747 21.3445L18.2528 15.1635ZM18.8131 23.2346L16.0544 18.9047L17.7384 16.047L21.3616 21.7577L18.8131 23.2346Z" fill="#213147"/><path d="M16.0547 18.9065L18.8134 23.2365L21.3619 21.7596L17.7387 16.0488L16.0547 18.9065Z" fill="#12AAFF"/><path d="M23.6825 20.0215L23.6806 18.8381L19.7217 12.6719L18.2529 15.1642L22.0747 21.3452L23.4566 20.5444C23.5921 20.4343 23.6741 20.2728 23.6827 20.0985L23.6825 20.0215Z" fill="#12AAFF"/><path d="M7.09277 21.1376L9.04413 22.2621L15.5378 11.848L14.4357 11.8189C13.4967 11.8056 12.4852 12.0498 12.0209 12.8076L8.33335 18.5232L7.09277 20.4293V21.1376Z" fill="white"/><path d="M19.2857 11.8457L16.381 11.8562L9.80957 22.7004L12.1065 24.0229L12.7311 22.9635L19.2857 11.8457Z" fill="white"/><path d="M24.9067 11.8325C24.8824 11.2251 24.5535 10.669 24.0383 10.3452L16.8173 6.1926C16.3077 5.93599 15.6711 5.93566 15.1605 6.19243C15.1002 6.22287 8.13826 10.2605 8.13826 10.2605C8.0419 10.3067 7.94909 10.3618 7.8618 10.4242C7.4019 10.7538 7.12157 11.2661 7.09277 11.8288V20.4288L8.33335 18.5227L8.32252 11.8869C8.32396 11.8626 8.32701 11.8388 8.33134 11.8152C8.35939 11.6591 8.44656 11.5198 8.5778 11.4257C8.61055 11.4022 15.6914 7.30354 15.7139 7.29229C15.8803 7.20871 16.0919 7.20772 16.2585 7.2897L23.3861 11.3895C23.5547 11.4969 23.6604 11.679 23.6698 11.8781V20.0981C23.6612 20.2724 23.5923 20.434 23.4567 20.5441L22.0749 21.3448L21.3619 21.758L18.8134 23.235L16.229 24.7327C16.0898 24.783 15.927 24.7801 15.789 24.724L12.7312 22.9653L12.1066 24.0247L14.8545 25.6068C14.9454 25.6585 15.0263 25.7043 15.0928 25.7416C15.1956 25.7993 15.2657 25.8379 15.2905 25.8499C15.4858 25.9448 15.7668 26 16.0201 26C16.2522 26 16.4786 25.9574 16.6928 25.8734L24.1996 21.5261C24.6304 21.1923 24.8839 20.6888 24.9067 20.1435V11.8325Z" fill="#9DCCED"/></g><defs><clipPath id="clip0_12476_3620"><rect width="32" height="32" fill="white"/></clipPath></defs></svg>`
arbitrum.primaryColor = `#12AAFF`
arbitrum.textColor = `#fff`

// Polygon
//<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_10991_3429)"><path d="M0 0H18V18H0V0Z" fill="#6C00F6"/><path d="M4 11.56V8.68L6.8 7.19L7.75 7.73V9.03L6.8 8.5L5.25 9.29V10.89L6.8 11.71L8.38 10.89V6.44L11.15 5L14 6.44V9.33L11.16 10.78L10.25 10.25V8.96L11.16 9.47L12.75 8.67V7.1L11.16 6.3L9.62 7.1V11.57L6.8 13L4 11.56Z" fill="white"/></g><defs><clipPath id="clip0_10991_3429"><rect width="18" height="18" fill="white"/></clipPath></defs></svg>

// Chain icons render in several places at once (header popover, pages), and
// inline <svg> defs (gradients, clipPaths) collide on duplicate ids across
// instances — a hidden copy breaks visible ones. Expose each icon as a
// data-URI so <img> renders it in its own isolated SVG document.
const iconChains = [
  mainnet,
  sepolia,
  lukso,
  celo,
  base,
  baseSepolia,
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
  chain.iconUrl = `data:image/svg+xml,${encodeURIComponent(chain.icon)}`
})

export const config = createConfig({
  chains: appChains,
  // WalletConnect's provider touches browser-only storage (indexedDB) the
  // moment it is constructed, and this module also evaluates on the server
  // (SSR and any API route reaching wagmi through an import chain) — so
  // connectors only exist in the browser.
  connectors: typeof window === 'undefined' ? [] : [injected(), walletConnect({ projectId }), safe()],
  transports: {
    // viem's default mainnet endpoint (eth.merkle.io) sends no Access-Control-Allow-Origin, so
    // every browser read on chain 1 fails CORS — the profile Assets tab showed no Ethereum row
    // at all until this was pinned to an endpoint that allows cross-origin calls.
    [mainnet.id]: http('https://ethereum-rpc.publicnode.com'),
    [lukso.id]: http(),
    [bsc.id]: http(),
    // The official Robinhood endpoint (rpc.mainnet.chain.robinhood.com) sends a malformed
    // Access-Control-Allow-Origin ('*,*') that browsers reject — every client-side read on
    // 4663 (swap quotes, balances) fails CORS against it. Publicnode passes preflight.
    [robinhood.id]: http('https://robinhood-rpc.publicnode.com'),
    [monad.id]: http(),
    [arbitrum.id]: http(),
    [base.id]: http(),
    [baseSepolia.id]: http(),
    [celo.id]: http(),
  },
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

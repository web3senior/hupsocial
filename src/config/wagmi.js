import { createConfig, http, webSocket } from 'wagmi'
import {
  lukso,
  celo,
  sepolia,
  base,
  monad,
  bsc,
  monadTestnet,
  arbitrumSepolia,
  somniaTestnet,
  unichainSepolia,
  optimismSepolia,
  lineaSepolia,
} from 'wagmi/chains'
import { injected, safe, walletConnect } from 'wagmi/connectors'

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || ``
// const noopStorage = {
//   getItem: () => null,
//   setItem: () => {},
//   removeItem: () => {},
// }

export const CONTRACTS = {
  chain42: {
    name: 'lukso',
    forwarder: '0xd21EEb8df33D47e80dcf6d3776e6bE702982B112',
    hup: '0xf6eeC4e32a532b23ACC56b72865e79c79877CEc8',
    status: '0xeCF2c230df65F50482c687040b272A808F753849',
    chat: '',
  },
  chain42220: {
    name: 'celo',
    forwarder: '0x46a3dfcb1f4ec29db7f96c0d3962df20e6edb259',
    hup: '0xdda507afa7be1e70b9dceeb3b34c9b886c98ff73',
    status: '0xe7A1F3601b6dCA2F0D5176cd9d8FFA10479D3Ed0',
    chat: '0x39024439A364b2997ceDBf12869eB709dc4A4850',
  },
  chain8453: {
    name: 'base',
    forwarder: '0xae95e44D2642F568D0e0Fc0d60202B55c8764567',
    hup: '0xE401aF10CAa79F9Bb6945C87Ee196503E5DE6BEA',
    status: '0xc9ddc0E09eFa8D3333DFEdFFd68157BC2a9026F3',
  },
  chain143: {
    name: 'monad',
    forwarder: '0x8466799e31a86a4d51B76154e57B14DcAF9A8756',
    hup: '0x8b76923EA3BFAA8EB29FC58e81E49F3c4Fa9Ba8A',
    status: '0xcDc18688D98Ff84fF5352d1ddDe183De7817Df98',
    publicKeyRegistry: '0xe7A1F3601b6dCA2F0D5176cd9d8FFA10479D3Ed0',
    chat: '0x93b3a0BBCA40cD11a03717ac31B4F45a2FDa7C52',
  },
  chain56: {
    name: 'bnb',
    forwarder: '0xc407722d150c8a65e890096869f8015D90a89EfD',
    hup: '0xA5e73b15c1C3eE477AED682741f0324C6787bbb8',
    status: '0x81c5a8fd5771cB398e2461cEF9Abb2eCD308d4c8',
  },
  chain10143: {
    name: 'monad-testnet',
    forwarder: '0x7C71e48C3916EdBBeFB84918A48e0b26FecC5D9c',
    hup: '0x77F884698945883841384bCA8bE6df17fCB7c04D',
    status: '',
    community: '0x021Ee55BaA5058A38A4BF3AAbd90f5c1b31068CD',
    nft: '0x4E6Bab4961Ab53D70745E791FA727993A4221d1F', // GenesisHup
  },
}

// Customize chains object
// LUKSO
lukso.icon = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_10950_4143)"><g clip-path="url(#clip1_10950_4143)"><path d="M15.6858 3.4167L10.4508 0.415708C9.52382 -0.117736 8.37782 -0.117736 7.45082 0.415708L2.21582 3.4167C1.28882 3.95014 0.71582 4.93359 0.71582 5.9975V12.0025C0.71582 13.0664 1.28882 14.0498 2.21582 14.5833L7.45082 17.5872C8.37782 18.1207 9.52382 18.1207 10.4508 17.5872L15.6858 14.5833C16.6128 14.0498 17.1858 13.0664 17.1858 12.0025V5.9975C17.1858 4.93359 16.6158 3.95014 15.6858 3.4167ZM13.1058 9.59749L11.5488 12.2766C11.3358 12.6462 10.9398 12.8727 10.5108 12.8727H7.39382C6.96482 12.8727 6.56882 12.6462 6.35582 12.2766L4.79582 9.59749C4.58282 9.22796 4.58282 8.77498 4.79582 8.40544L6.35282 5.7263C6.56582 5.35677 6.96182 5.13028 7.39082 5.13028H10.5048C10.9338 5.13028 11.3298 5.35677 11.5428 5.7263L13.0998 8.40544C13.3188 8.77498 13.3188 9.22796 13.1058 9.59749Z" fill="#FE005B"/></g></g><defs><clipPath id="clip0_10950_4143"><rect width="18" height="18" fill="white"/></clipPath><clipPath id="clip1_10950_4143"><rect width="16.3907" height="18" fill="white" transform="translate(0.701172)"/></clipPath></defs></svg>`
lukso.faucetUrl = `https://faucet.testnet.lukso.network/`
// luksoTestnet.rpcUrls.default.http = [
//   `https://4201.rpc.thirdweb.com/${process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID}`,
// ]
lukso.primaryColor = `#FD1669`
lukso.textColor = `#fff`

// CELO
celo.icon = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"> <g clip-path="url(#clip0_10733_2648)"> <path d="M0 0H18V18H0V0Z" fill="#FCFE52"/> <path d="M5 5H13V8H11.83C11.5941 7.33279 11.1299 6.77045 10.5195 6.41237C9.90911 6.05429 9.19176 5.92353 8.49427 6.0432C7.79677 6.16288 7.16404 6.52527 6.70789 7.06634C6.25175 7.60741 6.00157 8.29231 6.00157 9C6.00157 9.70769 6.25175 10.3926 6.70789 10.9337C7.16404 11.4747 7.79677 11.8371 8.49427 11.9568C9.19176 12.0765 9.90911 11.9457 10.5195 11.5876C11.1299 11.2296 11.5941 10.6672 11.83 10H13V13H5V5Z" fill="black"/> </g> <defs> <clipPath id="clip0_10733_2648"> <rect width="18" height="18" fill="white"/> </clipPath> </defs> </svg>`
celo.faucetUrl = `https://faucet.celo.org/celo-sepolia/`
celo.primaryColor = `#fcff52`
celo.textColor = `#333`

// Base
base.icon = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_11007_5115)"><path d="M18 0H0V18H18V0Z" fill="#0052FF"/><path d="M8.94604 14.1103C11.7979 14.1103 14.1098 11.8024 14.1098 8.95553C14.1098 6.10863 11.7979 3.80078 8.94604 3.80078C6.24039 3.80078 4.02074 5.87808 3.80029 8.52223H10.6256V9.38883H3.80029C4.02074 12.0329 6.24039 14.1103 8.94604 14.1103Z" fill="white"/></g><defs><clipPath id="clip0_11007_5115"><rect width="18" height="18" fill="white"/></clipPath></defs></svg>`
base.primaryColor = `#0052FF`
base.textColor = `#fff`

// Monad
monad.icon = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_10745_2838)"><path d="M8.99994 0C6.40097 0 0 6.4008 0 8.99994C0 11.5991 6.40097 18 8.99994 18C11.5989 18 18 11.599 18 8.99994C18 6.40091 11.599 0 8.99994 0ZM7.59746 14.1464C6.50149 13.8478 3.55489 8.69344 3.85359 7.59746C4.15229 6.50143 9.30656 3.55488 10.4025 3.85358C11.4985 4.15222 14.4451 9.30651 14.1464 10.4025C13.8477 11.4985 8.69344 14.4451 7.59746 14.1464Z" fill="#836EF9"/></g><defs><clipPath id="clip0_10745_2838"><rect width="18" height="18" fill="white"/></clipPath></defs></svg>`
monad.faucetUrl = `https://faucet.quicknode.com/monad/testnet`
monad.primaryColor = `#836EF9`
monad.textColor = `#fff`

monadTestnet.icon = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="18" height="18" fill="white"/><path d="M8.99996 3C7.26731 3 3 7.2672 3 8.99996C3 10.7327 7.26731 15 8.99996 15C10.7326 15 15 10.7326 15 8.99996C15 7.26727 10.7327 3 8.99996 3ZM8.06498 12.431C7.33433 12.2319 5.36993 8.79563 5.56906 8.06498C5.76819 7.33429 9.20437 5.36992 9.93499 5.56905C10.6657 5.76815 12.6301 9.20434 12.431 9.93503C12.2318 10.6657 8.79563 12.6301 8.06498 12.431Z" fill="#836EF9"/></svg>`
monadTestnet.faucetUrl = `https://faucet.quicknode.com/monad/testnet`
monadTestnet.primaryColor = `#836EF9`
monadTestnet.textColor = `#fff`

// Linea
lineaSepolia.icon = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"> <g clip-path="url(#clip0_10733_2645)"> <path d="M0 0H18V18H0V0Z" fill="#190066"/> <path d="M6.4 11.67H12V13H5V6H6.4V11.67ZM11.75 4.5C12.0815 4.5 12.3995 4.6317 12.6339 4.86612C12.8683 5.10054 13 5.41848 13 5.75C13 6.08152 12.8683 6.39946 12.6339 6.63388C12.3995 6.8683 12.0815 7 11.75 7C11.4185 7 11.1005 6.8683 10.8661 6.63388C10.6317 6.39946 10.5 6.08152 10.5 5.75C10.5 5.41848 10.6317 5.10054 10.8661 4.86612C11.1005 4.6317 11.4185 4.5 11.75 4.5Z" fill="#61DFFF"/> </g> <defs> <clipPath id="clip0_10733_2645"> <rect width="18" height="18" fill="white"/> </clipPath> </defs> </svg>`
lineaSepolia.primaryColor = `#190066`
lineaSepolia.textColor = `#61DFFF`

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

// BNB
bsc.icon = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_10769_2638)"><rect width="18" height="18" fill="#0E0F13"/><path d="M0 0H18V18H0V0Z" fill="url(#paint0_linear_10769_2638)"/><path d="M4.57333 3.45333L8.66667 1L12.76 3.45333L11.2533 4.36L8.66667 2.81333L6.08 4.36L4.57333 3.45333ZM12.76 6.54667L11.2533 5.64L8.66667 7.18667L6.08 5.64L4.57333 6.54667V8.33333L7.16 9.88V13L8.66667 13.9067L10.1733 13V9.89333L12.76 8.34667V6.54667ZM12.76 11.44V9.62667L11.2533 10.5333V12.3467L12.76 11.44ZM13.8267 12.08L11.24 13.6267V15.44L15.3333 12.9867V8.09333L13.8267 8.98667V12.08ZM12.32 5L13.8267 5.90667V7.70667L15.3333 6.81333V5L13.8267 4.09333L12.32 5ZM7.16 14.28V16.0933L8.66667 17L10.1733 16.0933V14.28L8.66667 15.1867L7.16 14.28ZM4.57333 11.44L6.08 12.3467V10.5333L4.57333 9.62667V11.44ZM7.16 5L8.66667 5.90667L10.1733 5L8.66667 4.09333L7.16 5ZM3.50667 5.90667L5.01333 5L3.50667 4.09333L2 5V6.81333L3.50667 7.70667V5.90667ZM3.50667 8.98667L2 8.09333V12.9867L6.09333 15.44V13.6267L3.50667 12.08V9V8.98667Z" fill="#F0B90B"/></g><defs><linearGradient id="paint0_linear_10769_2638" x1="3.35" y1="3.12" x2="21.9" y2="24.43" gradientUnits="userSpaceOnUse"><stop stop-color="#1A1E21"/><stop offset="1" stop-color="#06060A"/></linearGradient><clipPath id="clip0_10769_2638"><rect width="18" height="18" fill="white"/></clipPath></defs></svg>`
bsc.primaryColor = `#F0B90B`
bsc.textColor = `#fff`

// Sepolia
sepolia.icon = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_10996_4352)"><path d="M18 0H0V18H18V0Z" fill="#627EEA"/><mask id="mask0_10996_4352" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="1" y="1" width="16" height="16"><path d="M16.5 1.5H1.5V16.5H16.5V1.5Z" fill="white"/></mask><g mask="url(#mask0_10996_4352)"><path d="M9 16.5C13.1421 16.5 16.5 13.1421 16.5 9C16.5 4.85787 13.1421 1.5 9 1.5C4.85787 1.5 1.5 4.85787 1.5 9C1.5 13.1421 4.85787 16.5 9 16.5Z" fill="#627EEA"/><path d="M9.2334 3.375V7.5328L12.7476 9.1031L9.2334 3.375Z" fill="white" fill-opacity="0.602"/><path d="M9.23345 3.375L5.71875 9.1031L9.23345 7.5328V3.375Z" fill="white"/><path d="M9.2334 11.7978V14.623L12.7499 9.75781L9.2334 11.7978Z" fill="white" fill-opacity="0.602"/><path d="M9.23345 14.623V11.7974L5.71875 9.75781L9.23345 14.623Z" fill="white"/><path d="M9.2334 11.1431L12.7476 9.10255L9.2334 7.5332V11.1431Z" fill="white" fill-opacity="0.2"/><path d="M5.71875 9.10255L9.23345 11.1431V7.5332L5.71875 9.10255Z" fill="white" fill-opacity="0.602"/></g></g><defs><clipPath id="clip0_10996_4352"><rect width="18" height="18" fill="white"/></clipPath></defs></svg>`
sepolia.primaryColor = `#627EEA`
sepolia.textColor = `#fff`

// Polygon
//<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_10991_3429)"><path d="M0 0H18V18H0V0Z" fill="#6C00F6"/><path d="M4 11.56V8.68L6.8 7.19L7.75 7.73V9.03L6.8 8.5L5.25 9.29V10.89L6.8 11.71L8.38 10.89V6.44L11.15 5L14 6.44V9.33L11.16 10.78L10.25 10.25V8.96L11.16 9.47L12.75 8.67V7.1L11.16 6.3L9.62 7.1V11.57L6.8 13L4 11.56Z" fill="white"/></g><defs><clipPath id="clip0_10991_3429"><rect width="18" height="18" fill="white"/></clipPath></defs></svg>

export const config = createConfig({
  chains: [lukso, celo, base, monad, bsc, monadTestnet], //somniaTestnet
  connectors: [injected(), walletConnect({ projectId }), safe()],
  transports: {
    [lukso.id]: http(),
    [celo.id]: http(),
    [base.id]: http(),
    [monad.id]: http(),
    [bsc.id]: http(),
    [monadTestnet.id]: http(),
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

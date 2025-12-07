import { createConfig, http } from 'wagmi'
import {
  sepolia,
  baseSepoliaPreconf,
  celoSepolia,
  opBNBTestnet,
  arbitrumSepolia,
  monadTestnet,
  somniaTestnet,
  unichainSepolia,
  optimismSepolia,
  luksoTestnet,
  lineaSepolia,
} from 'wagmi/chains'

const projectId = process.env.NEXT_PUBLIC_PROJECT_ID || ``

export const CONTRACTS = {
  // chain11155111: {
  //   post: '',
  //   comment: '',
  //   status: '',
  // },
  chain4201: {
    post: '0xCb885C28D1b005701249F92E43089b44204a7313',
    comment: '0x2a357c53cf617eb23a99A3E7fb0Be363e9dE8f04',
    status: '0x6B10B966C3369332De8c976da62249F38D6898ca',
  },
  chain11142220: {
    post: '0x83f954b754538e1302C69F4b8BCC0eE847302a2C',
    comment: '0x07F1BCE9585Fea0d72da07428A98293116634E4E',
    status: '0x13A71b258b685dFAC3bCe8b1530aAFD8daa180E1',
  },
  chain10143: {
    post: '0x4E6Bab4961Ab53D70745E791FA727993A4221d1F',
    comment: '0xc407722d150c8a65e890096869f8015D90a89EfD',
    status: '0xA5e73b15c1C3eE477AED682741f0324C6787bbb8',
  },
  chain59141: {
    post: '0x1DdDEF888817A7ae49dcFf10Ac65e86427A37236',
    comment: '0x927826f56603aD465504fe2Adb516EDCD16911ED',
    status: '0x9aE36e2aF99c918e679c2A92f216EdA3b2d895dA',
  },
  chain84532: {
    post: '0xf5e4d19c9de1323dfF4fd85822Ca7A3582035e76',
    comment: '0x4E6Bab4961Ab53D70745E791FA727993A4221d1F',
    status: '0xc407722d150c8a65e890096869f8015D90a89EfD',
  },
  chain11155420: {
    post: '0x4E6Bab4961Ab53D70745E791FA727993A4221d1F',
    comment: '0xc407722d150c8a65e890096869f8015D90a89EfD',
    status: '0xA5e73b15c1C3eE477AED682741f0324C6787bbb8',
  },
  chain1301: {
    post: '0xf5e4d19c9de1323dfF4fd85822Ca7A3582035e76',
    comment: '0x4E6Bab4961Ab53D70745E791FA727993A4221d1F',
    status: '0xc407722d150c8a65e890096869f8015D90a89EfD',
  },
  chain8408: {
    post: '0xf5e4d19c9de1323dfF4fd85822Ca7A3582035e76',
    comment: '0x4E6Bab4961Ab53D70745E791FA727993A4221d1F',
    status: '0xc407722d150c8a65e890096869f8015D90a89EfD',
  },
  chain421614: {
    post: '0xddA507aFA7bE1e70B9dceEB3B34c9B886C98Ff73',
    comment: '0xA724524E11c971B8a98165DEc9065eBa563d424a',
    status: '0x167486b8d7879351345378e1302EaD995CA9c505',
  },
}

// Customize chains object
// LUKSO
luksoTestnet.icon = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_10950_4143)"><mask id="mask0_10950_4143" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="0" y="0" width="18" height="18"><path d="M18 0H0V18H18V0Z" fill="white"/></mask><g mask="url(#mask0_10950_4143)"><path d="M0 0H18V18H0V0Z" fill="#F0F3FA"/><path d="M10.0922 3.26602L13.908 5.2667C14.58 5.62682 15 6.27704 15 6.98729V10.9986C15 11.7089 14.58 12.3691 13.908 12.7293L10.0922 14.7299C9.4202 15.09 8.58023 15.09 7.90826 14.7299L4.09237 12.7293C3.75034 12.5407 3.47094 12.2832 3.28006 11.9807C3.08917 11.6782 2.99298 11.3404 3.0004 10.9986V6.99729C3.0004 6.27704 3.42039 5.62682 4.09237 5.2667L7.90826 3.26602C8.23434 3.0923 8.61323 3 9.00022 3C9.3872 3 9.7661 3.0923 10.0922 3.26602ZM10.4521 10.6885L11.3161 9.30808C11.4361 9.10802 11.4361 8.87794 11.3161 8.68787L10.4401 7.3074C10.3875 7.21668 10.3059 7.13978 10.2042 7.0851C10.1027 7.0304 9.98506 7.00003 9.86419 6.99729H8.13624C7.89626 6.99729 7.66825 7.11733 7.56027 7.29739L6.68429 8.69787C6.56429 8.87794 6.56429 9.11801 6.68429 9.29807L7.56027 10.6985C7.68025 10.8786 7.89626 10.9986 8.13624 10.9986H9.86419C10.1042 10.9986 10.3321 10.8786 10.4401 10.6985L10.4521 10.6885Z" fill="#FE005B"/></g></g><defs><clipPath id="clip0_10950_4143"><rect width="18" height="18" fill="white"/></clipPath></defs></svg>`
luksoTestnet.faucetUrl = `https://faucet.testnet.lukso.network/`
luksoTestnet.primaryColor = `#FD1669`
luksoTestnet.textColor = `#fff`

// CELO
celoSepolia.icon = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"> <g clip-path="url(#clip0_10733_2648)"> <path d="M0 0H18V18H0V0Z" fill="#FCFE52"/> <path d="M5 5H13V8H11.83C11.5941 7.33279 11.1299 6.77045 10.5195 6.41237C9.90911 6.05429 9.19176 5.92353 8.49427 6.0432C7.79677 6.16288 7.16404 6.52527 6.70789 7.06634C6.25175 7.60741 6.00157 8.29231 6.00157 9C6.00157 9.70769 6.25175 10.3926 6.70789 10.9337C7.16404 11.4747 7.79677 11.8371 8.49427 11.9568C9.19176 12.0765 9.90911 11.9457 10.5195 11.5876C11.1299 11.2296 11.5941 10.6672 11.83 10H13V13H5V5Z" fill="black"/> </g> <defs> <clipPath id="clip0_10733_2648"> <rect width="18" height="18" fill="white"/> </clipPath> </defs> </svg>`
celoSepolia.faucetUrl = `https://faucet.celo.org/celo-sepolia/`
celoSepolia.primaryColor = `#fcff52`
celoSepolia.textColor = `#333`

// Base
baseSepoliaPreconf.icon = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_11007_5115)"><path d="M18 0H0V18H18V0Z" fill="#0052FF"/><path d="M8.94604 14.1103C11.7979 14.1103 14.1098 11.8024 14.1098 8.95553C14.1098 6.10863 11.7979 3.80078 8.94604 3.80078C6.24039 3.80078 4.02074 5.87808 3.80029 8.52223H10.6256V9.38883H3.80029C4.02074 12.0329 6.24039 14.1103 8.94604 14.1103Z" fill="white"/></g><defs><clipPath id="clip0_11007_5115"><rect width="18" height="18" fill="white"/></clipPath></defs></svg>`
baseSepoliaPreconf.primaryColor = `#0052FF`
baseSepoliaPreconf.textColor = `#fff`

// Monad
monadTestnet.icon = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="18" height="18" fill="white"/><path d="M8.99996 3C7.26731 3 3 7.2672 3 8.99996C3 10.7327 7.26731 15 8.99996 15C10.7326 15 15 10.7326 15 8.99996C15 7.26727 10.7327 3 8.99996 3ZM8.06498 12.431C7.33433 12.2319 5.36993 8.79563 5.56906 8.06498C5.76819 7.33429 9.20437 5.36992 9.93499 5.56905C10.6657 5.76815 12.6301 9.20434 12.431 9.93503C12.2318 10.6657 8.79563 12.6301 8.06498 12.431Z" fill="#836EF9"/></svg>`
monadTestnet.faucetUrl = `https://faucet.monad.xyz/`
monadTestnet.rpcUrls.default.http = ['https://rpc.ankr.com/monad_testnet']
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
opBNBTestnet.icon = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"> <g clip-path="url(#clip0_10769_2638)"> <path d="M0 0H18V18H0V0Z" fill="url(#paint0_linear_10769_2638)"/> <path d="M5.93 4.84L9 3L12.07 4.84L10.94 5.52L9 4.36L7.06 5.52L5.93 4.84ZM12.07 7.16L10.94 6.48L9 7.64L7.06 6.48L5.93 7.16V8.5L7.87 9.66V12L9 12.68L10.13 12V9.67L12.07 8.51V7.16ZM12.07 10.83V9.47L10.94 10.15V11.51L12.07 10.83ZM12.87 11.31L10.93 12.47V13.83L14 11.99V8.32L12.87 8.99V11.31ZM11.74 6L12.87 6.68V8.03L14 7.36V6L12.87 5.32L11.74 6ZM7.87 12.96V14.32L9 15L10.13 14.32V12.96L9 13.64L7.87 12.96ZM5.93 10.83L7.06 11.51V10.15L5.93 9.47V10.83ZM7.87 6L9 6.68L10.13 6L9 5.32L7.87 6ZM5.13 6.68L6.26 6L5.13 5.32L4 6V7.36L5.13 8.03V6.68ZM5.13 8.99L4 8.32V11.99L7.07 13.83V12.47L5.13 11.31V9V8.99Z" fill="#F0B90B"/> </g> <defs> <linearGradient id="paint0_linear_10769_2638" x1="3.35" y1="3.12" x2="21.9" y2="24.43" gradientUnits="userSpaceOnUse"> <stop stop-color="#1A1E21"/> <stop offset="1" stop-color="#06060A"/> </linearGradient> <clipPath id="clip0_10769_2638"> <rect width="18" height="18" fill="white"/> </clipPath> </defs> </svg>`
opBNBTestnet.primaryColor = `#F0B90B`
opBNBTestnet.textColor = `#fff`

// Sepolia
sepolia.icon = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_10996_4352)"><path d="M18 0H0V18H18V0Z" fill="#627EEA"/><mask id="mask0_10996_4352" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="1" y="1" width="16" height="16"><path d="M16.5 1.5H1.5V16.5H16.5V1.5Z" fill="white"/></mask><g mask="url(#mask0_10996_4352)"><path d="M9 16.5C13.1421 16.5 16.5 13.1421 16.5 9C16.5 4.85787 13.1421 1.5 9 1.5C4.85787 1.5 1.5 4.85787 1.5 9C1.5 13.1421 4.85787 16.5 9 16.5Z" fill="#627EEA"/><path d="M9.2334 3.375V7.5328L12.7476 9.1031L9.2334 3.375Z" fill="white" fill-opacity="0.602"/><path d="M9.23345 3.375L5.71875 9.1031L9.23345 7.5328V3.375Z" fill="white"/><path d="M9.2334 11.7978V14.623L12.7499 9.75781L9.2334 11.7978Z" fill="white" fill-opacity="0.602"/><path d="M9.23345 14.623V11.7974L5.71875 9.75781L9.23345 14.623Z" fill="white"/><path d="M9.2334 11.1431L12.7476 9.10255L9.2334 7.5332V11.1431Z" fill="white" fill-opacity="0.2"/><path d="M5.71875 9.10255L9.23345 11.1431V7.5332L5.71875 9.10255Z" fill="white" fill-opacity="0.602"/></g></g><defs><clipPath id="clip0_10996_4352"><rect width="18" height="18" fill="white"/></clipPath></defs></svg>`
sepolia.primaryColor = `#627EEA`
sepolia.textColor = `#fff`

// Polygon
//<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_10991_3429)"><path d="M0 0H18V18H0V0Z" fill="#6C00F6"/><path d="M4 11.56V8.68L6.8 7.19L7.75 7.73V9.03L6.8 8.5L5.25 9.29V10.89L6.8 11.71L8.38 10.89V6.44L11.15 5L14 6.44V9.33L11.16 10.78L10.25 10.25V8.96L11.16 9.47L12.75 8.67V7.1L11.16 6.3L9.62 7.1V11.57L6.8 13L4 11.56Z" fill="white"/></g><defs><clipPath id="clip0_10991_3429"><rect width="18" height="18" fill="white"/></clipPath></defs></svg>

export const config = createConfig({
  chains: [baseSepoliaPreconf, luksoTestnet, arbitrumSepolia, celoSepolia, monadTestnet, lineaSepolia, optimismSepolia, unichainSepolia], //somniaTestnet, opBNBTestnet
  transports: {
    [luksoTestnet.id]: http(),
    [celoSepolia.id]: http(),
    [monadTestnet.id]: http(),
    [lineaSepolia.id]: http(),
    [baseSepoliaPreconf.id]: http(),
    [optimismSepolia.id]: http(),
    [unichainSepolia.id]: http(),
    [arbitrumSepolia.id]: http(),
  },
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

console.log(config)

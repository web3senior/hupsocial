'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
// import { config } from '@/config/wagmi'
import PageTitle from '@/components/PageTitle'
import styles from './page.module.scss'

const config = [
  {
    formatters: {
      block: {
        type: 'block',
      },
      transaction: {
        type: 'transaction',
      },
      transactionReceipt: {
        type: 'transactionReceipt',
      },
    },
    serializers: {},
    blockTime: 2000,
    contracts: {
      gasPriceOracle: {
        address: '0x420000000000000000000000000000000000000F',
      },
      l1Block: {
        address: '0x4200000000000000000000000000000000000015',
      },
      l2CrossDomainMessenger: {
        address: '0x4200000000000000000000000000000000000007',
      },
      l2Erc721Bridge: {
        address: '0x4200000000000000000000000000000000000014',
      },
      l2StandardBridge: {
        address: '0x4200000000000000000000000000000000000010',
      },
      l2ToL1MessagePasser: {
        address: '0x4200000000000000000000000000000000000016',
      },
      disputeGameFactory: {
        11155111: {
          address: '0xd6E6dBf4F7EA0ac412fD8b65ED297e64BB7a06E1',
        },
      },
      l2OutputOracle: {
        11155111: {
          address: '0x84457ca9D0163FbC4bbfe4Dfbb20ba46e48DF254',
        },
      },
      portal: {
        11155111: {
          address: '0x49f53e41452c74589e85ca1677426ba426459e85',
          blockCreated: 4446677,
        },
      },
      l1StandardBridge: {
        11155111: {
          address: '0xfd0Bf71F60660E2f608ed56e1659C450eB113120',
          blockCreated: 4446677,
        },
      },
      multicall3: {
        address: '0xca11bde05977b3631167028862be2a173976ca11',
        blockCreated: 1059647,
      },
    },
    id: 84532,
    network: 'base-sepolia',
    name: 'Base Sepolia',
    nativeCurrency: {
      name: 'Sepolia Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: ['https://sepolia-preconf.base.org'],
      },
    },
    blockExplorers: {
      default: {
        name: 'Basescan',
        url: 'https://sepolia.basescan.org',
        apiUrl: 'https://api-sepolia.basescan.org/api',
      },
    },
    testnet: true,
    sourceId: 11155111,
    experimental_preconfirmationTime: 200,
    icon: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="18" height="18" fill="white"/><path d="M4 4H14V14H4V4Z" fill="#0000FF"/></svg>',
    primaryColor: '#0000FF',
    textColor: '#fff',
  },
  {
    id: 4201,
    name: 'LUKSO Testnet',
    nativeCurrency: {
      decimals: 18,
      name: 'LUKSO Testnet',
      symbol: 'LYXt',
    },
    rpcUrls: {
      default: {
        http: ['https://rpc.testnet.lukso.network'],
        webSocket: ['wss://ws-rpc.testnet.lukso.network'],
      },
    },
    blockExplorers: {
      default: {
        name: 'LUKSO Testnet Explorer',
        url: 'https://explorer.execution.testnet.lukso.network',
        apiUrl: 'https://api.explorer.execution.testnet.lukso.network/api',
      },
    },
    contracts: {
      multicall3: {
        address: '0xcA11bde05977b3631167028862bE2a173976CA11',
        blockCreated: 605348,
      },
    },
    testnet: true,
    icon: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_10950_4143)"><mask id="mask0_10950_4143" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="0" y="0" width="18" height="18"><path d="M18 0H0V18H18V0Z" fill="white"/></mask><g mask="url(#mask0_10950_4143)"><path d="M0 0H18V18H0V0Z" fill="#F0F3FA"/><path d="M10.0922 3.26602L13.908 5.2667C14.58 5.62682 15 6.27704 15 6.98729V10.9986C15 11.7089 14.58 12.3691 13.908 12.7293L10.0922 14.7299C9.4202 15.09 8.58023 15.09 7.90826 14.7299L4.09237 12.7293C3.75034 12.5407 3.47094 12.2832 3.28006 11.9807C3.08917 11.6782 2.99298 11.3404 3.0004 10.9986V6.99729C3.0004 6.27704 3.42039 5.62682 4.09237 5.2667L7.90826 3.26602C8.23434 3.0923 8.61323 3 9.00022 3C9.3872 3 9.7661 3.0923 10.0922 3.26602ZM10.4521 10.6885L11.3161 9.30808C11.4361 9.10802 11.4361 8.87794 11.3161 8.68787L10.4401 7.3074C10.3875 7.21668 10.3059 7.13978 10.2042 7.0851C10.1027 7.0304 9.98506 7.00003 9.86419 6.99729H8.13624C7.89626 6.99729 7.66825 7.11733 7.56027 7.29739L6.68429 8.69787C6.56429 8.87794 6.56429 9.11801 6.68429 9.29807L7.56027 10.6985C7.68025 10.8786 7.89626 10.9986 8.13624 10.9986H9.86419C10.1042 10.9986 10.3321 10.8786 10.4401 10.6985L10.4521 10.6885Z" fill="#FE005B"/></g></g><defs><clipPath id="clip0_10950_4143"><rect width="18" height="18" fill="white"/></clipPath></defs></svg>',
    faucetUrl: 'https://faucet.testnet.lukso.network/',
    primaryColor: '#FD1669',
    textColor: '#fff',
  },
  {
    id: 421614,
    name: 'Arbitrum Sepolia',
    blockTime: 250,
    nativeCurrency: {
      name: 'Arbitrum Sepolia Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: ['https://sepolia-rollup.arbitrum.io/rpc'],
      },
    },
    blockExplorers: {
      default: {
        name: 'Arbiscan',
        url: 'https://sepolia.arbiscan.io',
        apiUrl: 'https://api-sepolia.arbiscan.io/api',
      },
    },
    contracts: {
      multicall3: {
        address: '0xca11bde05977b3631167028862be2a173976ca11',
        blockCreated: 81930,
      },
    },
    testnet: true,
    icon: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"> <g clip-path="url(#clip0_10733_2639)"> <path d="M0 0H18V18H0V0Z" fill="#213147"/> <path d="M9.84015 9.91092L9.29015 11.5109C9.27568 11.553 9.27568 11.5988 9.29015 11.6409L10.2302 14.3809L11.3202 13.7209L10.0202 9.92092C10.012 9.90401 9.99918 9.88975 9.98326 9.87977C9.96735 9.8698 9.94894 9.8645 9.93015 9.8645C9.91137 9.8645 9.89296 9.8698 9.87705 9.87977C9.86113 9.88975 9.84834 9.90401 9.84015 9.92092V9.91092ZM10.9302 7.23092C10.9212 7.21644 10.9087 7.2045 10.8938 7.19622C10.8789 7.18794 10.8622 7.18359 10.8452 7.18359C10.8281 7.18359 10.8114 7.18794 10.7965 7.19622C10.7816 7.2045 10.7691 7.21644 10.7602 7.23092L10.2102 8.83092C10.1957 8.87304 10.1957 8.91879 10.2102 8.96092L11.7502 13.4609L12.8402 12.7809L10.9402 7.23092H10.9302Z" fill="#12AAFF"/> <path d="M9 3.67C9.03 3.67 9.05 3.67 9.08 3.69L13.3 6.31C13.35 6.34 13.38 6.39 13.38 6.45V11.55C13.38 11.6 13.35 11.65 13.3 11.69L9.08 14.3C9.05605 14.3151 9.02831 14.3231 9 14.3231C8.97169 14.3231 8.94395 14.3151 8.92 14.3L4.7 11.7C4.67612 11.6851 4.65631 11.6645 4.64235 11.6401C4.62838 11.6157 4.62071 11.5881 4.62 11.56V6.46C4.62 6.4 4.65 6.36 4.7 6.32L8.92 3.7C8.94289 3.68191 8.97086 3.67142 9 3.67ZM9 3C8.85 3 8.7 3.04 8.57 3.12L4.43 5.67C4.29815 5.75297 4.18953 5.86807 4.11432 6.0045C4.03911 6.14092 3.99977 6.29421 4 6.45V11.55C4 11.87 4.16 12.17 4.43 12.33L8.57 14.88C8.69889 14.9607 8.84791 15.0036 9 15.0036C9.15209 15.0036 9.30111 14.9607 9.43 14.88L13.57 12.33C13.7033 12.2461 13.8128 12.1295 13.8881 11.9911C13.9634 11.8528 14.0019 11.6975 14 11.54V6.45C13.9993 6.29439 13.9596 6.14145 13.8844 6.00518C13.8093 5.8689 13.7012 5.75366 13.57 5.67L9.43 3.12C9.30032 3.04148 9.1516 2.99998 9 3Z" fill="#9DCCED"/> <path d="M6.25977 13.4596L6.63977 12.3496L7.40977 13.0196L6.68977 13.7196L6.25977 13.4596Z" fill="#213147"/> <path d="M8.64992 6H7.59992C7.56099 6.00414 7.52414 6.01961 7.49392 6.04449C7.4637 6.06938 7.44145 6.10259 7.42992 6.14L5.16992 12.78L6.25992 13.46L8.73992 6.14C8.75992 6.07 8.71992 6 8.64992 6ZM10.4999 6H9.42992C9.39181 6.00208 9.3552 6.0156 9.32488 6.03879C9.29455 6.06198 9.27192 6.09376 9.25992 6.13L6.67992 13.71L7.76992 14.39L10.5699 6.14C10.5899 6.07 10.5499 6 10.4799 6H10.4999Z" fill="white"/> </g> <defs> <clipPath id="clip0_10733_2639"> <rect width="18" height="18" fill="white"/> </clipPath> </defs> </svg>',
    primaryColor: '#213147',
    textColor: '#12AAFF',
  },
  {
    formatters: {
      block: {
        type: 'block',
      },
      transaction: {
        type: 'transaction',
      },
      transactionRequest: {
        type: 'transactionRequest',
      },
    },
    fees: {},
    serializers: {},
    blockTime: 1000,
    contracts: {
      gasPriceOracle: {
        address: '0x420000000000000000000000000000000000000F',
      },
      l1Block: {
        address: '0x4200000000000000000000000000000000000015',
      },
      l2CrossDomainMessenger: {
        address: '0x4200000000000000000000000000000000000007',
      },
      l2Erc721Bridge: {
        address: '0x4200000000000000000000000000000000000014',
      },
      l2StandardBridge: {
        address: '0x4200000000000000000000000000000000000010',
      },
      l2ToL1MessagePasser: {
        address: '0x4200000000000000000000000000000000000016',
      },
      multicall3: {
        address: '0xcA11bde05977b3631167028862bE2a173976CA11',
        blockCreated: 1,
      },
      portal: {
        11155111: {
          address: '0x44ae3d41a335a7d05eb533029917aad35662dcc2',
          blockCreated: 8825790,
        },
      },
      disputeGameFactory: {
        11155111: {
          address: '0x57c45d82d1a995f1e135b8d7edc0a6bb5211cfaa',
          blockCreated: 8825790,
        },
      },
      l1StandardBridge: {
        11155111: {
          address: '0xec18a3c30131a0db4246e785355fbc16e2eaf408',
          blockCreated: 8825790,
        },
      },
    },
    id: 11142220,
    name: 'Celo Sepolia Testnet',
    nativeCurrency: {
      decimals: 18,
      name: 'CELO',
      symbol: 'S-CELO',
    },
    rpcUrls: {
      default: {
        http: ['https://forno.celo-sepolia.celo-testnet.org'],
      },
    },
    blockExplorers: {
      default: {
        name: 'Celo Sepolia Explorer',
        url: 'https://celo-sepolia.blockscout.com/',
        apiUrl: 'https://celo-sepolia.blockscout.com/api',
      },
    },
    testnet: true,
    icon: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"> <g clip-path="url(#clip0_10733_2648)"> <path d="M0 0H18V18H0V0Z" fill="#FCFE52"/> <path d="M5 5H13V8H11.83C11.5941 7.33279 11.1299 6.77045 10.5195 6.41237C9.90911 6.05429 9.19176 5.92353 8.49427 6.0432C7.79677 6.16288 7.16404 6.52527 6.70789 7.06634C6.25175 7.60741 6.00157 8.29231 6.00157 9C6.00157 9.70769 6.25175 10.3926 6.70789 10.9337C7.16404 11.4747 7.79677 11.8371 8.49427 11.9568C9.19176 12.0765 9.90911 11.9457 10.5195 11.5876C11.1299 11.2296 11.5941 10.6672 11.83 10H13V13H5V5Z" fill="black"/> </g> <defs> <clipPath id="clip0_10733_2648"> <rect width="18" height="18" fill="white"/> </clipPath> </defs> </svg>',
    faucetUrl: 'https://faucet.celo.org/celo-sepolia/',
    primaryColor: '#fcff52',
    textColor: '#333',
  },
  {
    id: 10143,
    name: 'Monad Testnet',
    blockTime: 400,
    nativeCurrency: {
      name: 'Testnet MON Token',
      symbol: 'MON',
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: ['https://rpc.ankr.com/monad_testnet'],
      },
    },
    blockExplorers: {
      default: {
        name: 'Monad Testnet explorer',
        url: 'https://testnet.monadexplorer.com',
      },
    },
    contracts: {
      multicall3: {
        address: '0xcA11bde05977b3631167028862bE2a173976CA11',
        blockCreated: 251449,
      },
    },
    testnet: true,
    icon: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="18" height="18" fill="white"/><path d="M8.99996 3C7.26731 3 3 7.2672 3 8.99996C3 10.7327 7.26731 15 8.99996 15C10.7326 15 15 10.7326 15 8.99996C15 7.26727 10.7327 3 8.99996 3ZM8.06498 12.431C7.33433 12.2319 5.36993 8.79563 5.56906 8.06498C5.76819 7.33429 9.20437 5.36992 9.93499 5.56905C10.6657 5.76815 12.6301 9.20434 12.431 9.93503C12.2318 10.6657 8.79563 12.6301 8.06498 12.431Z" fill="#836EF9"/></svg>',
    faucetUrl: 'https://faucet.monad.xyz/',
    primaryColor: '#836EF9',
    textColor: '#fff',
  },
  {
    fees: {},
    id: 59141,
    name: 'Linea Sepolia Testnet',
    nativeCurrency: {
      name: 'Linea Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: ['https://rpc.sepolia.linea.build'],
        webSocket: ['wss://rpc.sepolia.linea.build'],
      },
    },
    blockExplorers: {
      default: {
        name: 'Etherscan',
        url: 'https://sepolia.lineascan.build',
        apiUrl: 'https://api-sepolia.lineascan.build/api',
      },
    },
    contracts: {
      multicall3: {
        address: '0xca11bde05977b3631167028862be2a173976ca11',
        blockCreated: 227427,
      },
      ensRegistry: {
        address: '0x5B2636F0f2137B4aE722C01dd5122D7d3e9541f7',
        blockCreated: 2395094,
      },
      ensUniversalResolver: {
        address: '0x4D41762915F83c76EcaF6776d9b08076aA32b492',
        blockCreated: 17168484,
      },
    },
    ensTlds: ['.linea.eth'],
    testnet: true,
    icon: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"> <g clip-path="url(#clip0_10733_2645)"> <path d="M0 0H18V18H0V0Z" fill="#190066"/> <path d="M6.4 11.67H12V13H5V6H6.4V11.67ZM11.75 4.5C12.0815 4.5 12.3995 4.6317 12.6339 4.86612C12.8683 5.10054 13 5.41848 13 5.75C13 6.08152 12.8683 6.39946 12.6339 6.63388C12.3995 6.8683 12.0815 7 11.75 7C11.4185 7 11.1005 6.8683 10.8661 6.63388C10.6317 6.39946 10.5 6.08152 10.5 5.75C10.5 5.41848 10.6317 5.10054 10.8661 4.86612C11.1005 4.6317 11.4185 4.5 11.75 4.5Z" fill="#61DFFF"/> </g> <defs> <clipPath id="clip0_10733_2645"> <rect width="18" height="18" fill="white"/> </clipPath> </defs> </svg>',
    primaryColor: '#190066',
    textColor: '#61DFFF',
  },
  {
    formatters: {
      block: {
        type: 'block',
      },
      transaction: {
        type: 'transaction',
      },
      transactionReceipt: {
        type: 'transactionReceipt',
      },
    },
    serializers: {},
    blockTime: 2000,
    contracts: {
      gasPriceOracle: {
        address: '0x420000000000000000000000000000000000000F',
      },
      l1Block: {
        address: '0x4200000000000000000000000000000000000015',
      },
      l2CrossDomainMessenger: {
        address: '0x4200000000000000000000000000000000000007',
      },
      l2Erc721Bridge: {
        address: '0x4200000000000000000000000000000000000014',
      },
      l2StandardBridge: {
        address: '0x4200000000000000000000000000000000000010',
      },
      l2ToL1MessagePasser: {
        address: '0x4200000000000000000000000000000000000016',
      },
      disputeGameFactory: {
        11155111: {
          address: '0x05F9613aDB30026FFd634f38e5C4dFd30a197Fa1',
        },
      },
      l2OutputOracle: {
        11155111: {
          address: '0x90E9c4f8a994a250F6aEfd61CAFb4F2e895D458F',
        },
      },
      multicall3: {
        address: '0xca11bde05977b3631167028862be2a173976ca11',
        blockCreated: 1620204,
      },
      portal: {
        11155111: {
          address: '0x16Fc5058F25648194471939df75CF27A2fdC48BC',
        },
      },
      l1StandardBridge: {
        11155111: {
          address: '0xFBb0621E0B23b5478B630BD55a5f21f67730B0F1',
        },
      },
    },
    id: 11155420,
    name: 'OP Sepolia',
    nativeCurrency: {
      name: 'Sepolia Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: ['https://sepolia.optimism.io'],
      },
    },
    blockExplorers: {
      default: {
        name: 'Blockscout',
        url: 'https://optimism-sepolia.blockscout.com',
        apiUrl: 'https://optimism-sepolia.blockscout.com/api',
      },
    },
    testnet: true,
    sourceId: 11155111,
    icon: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_10964_3437)"><path d="M18 0H0V18H18V0Z" fill="#FE0420"/><path fill-rule="evenodd" clip-rule="evenodd" d="M3.64398 11.5333C4.07903 11.8444 4.63715 12 5.31834 12C6.14264 12 6.80091 11.8139 7.29322 11.4417C7.78551 11.0639 8.13181 10.4944 8.33218 9.73332C8.45238 9.26667 8.55541 8.78611 8.6413 8.29167C8.66992 8.11389 8.68421 7.96667 8.68421 7.85C8.68421 7.46111 8.58403 7.12778 8.38369 6.85C8.18333 6.56667 7.90858 6.35556 7.5594 6.21667C7.21021 6.07222 6.81524 6 6.37447 6C4.75449 6 3.74988 6.76389 3.36063 8.29167C3.22325 8.85278 3.11735 9.33333 3.04293 9.73332C3.01431 9.9111 3 10.0611 3 10.1833C3 10.7667 3.21466 11.2167 3.64398 11.5333ZM6.74367 9.68334C6.5793 10.3215 6.12578 10.7368 5.43855 10.7368C4.75869 10.7368 4.52622 10.2771 4.64859 9.68334C4.75163 9.14445 4.85467 8.68889 4.95771 8.31667C5.13523 7.62748 5.55191 7.26316 6.26284 7.26316C6.93965 7.26316 7.16201 7.71644 7.04422 8.31667C6.9755 8.70556 6.87535 9.1611 6.74367 9.68334ZM9.34562 11.94C9.37902 11.98 9.42633 12 9.48761 12H10.6235C10.6792 12 10.732 11.98 10.7822 11.94C10.8323 11.9 10.8629 11.8486 10.874 11.7857L11.2693 10H12.425C13.1544 10 13.6887 9.75144 14.1063 9.43716C14.5295 9.12285 14.8107 8.63714 14.9499 7.98C14.9833 7.82571 15 7.67714 15 7.53429C15 7.03714 14.8107 6.65714 14.432 6.39429C14.059 6.13143 13.5634 6 12.9453 6H10.7237C10.668 6 10.6151 6.02 10.565 6.06C10.5149 6.1 10.4843 6.15143 10.4731 6.21429L9.32055 11.7857C9.30941 11.8429 9.31778 11.8943 9.34562 11.94ZM13.4047 7.96286C13.3008 8.4217 12.9369 8.74352 12.4671 8.74352H11.5066L11.8011 7.26316H12.8034C13.1446 7.26316 13.4298 7.33041 13.4298 7.70571C13.4298 7.78 13.4214 7.86571 13.4047 7.96286Z" fill="white"/></g><defs><clipPath id="clip0_10964_3437"><rect width="18" height="18" fill="white"/></clipPath></defs></svg>',
    primaryColor: '#FE0420',
    textColor: '#fff',
  },
  {
    formatters: {
      block: {
        type: 'block',
      },
      transaction: {
        type: 'transaction',
      },
      transactionReceipt: {
        type: 'transactionReceipt',
      },
    },
    serializers: {},
    blockTime: 1000,
    contracts: {
      gasPriceOracle: {
        address: '0x420000000000000000000000000000000000000F',
      },
      l1Block: {
        address: '0x4200000000000000000000000000000000000015',
      },
      l2CrossDomainMessenger: {
        address: '0x4200000000000000000000000000000000000007',
      },
      l2Erc721Bridge: {
        address: '0x4200000000000000000000000000000000000014',
      },
      l2StandardBridge: {
        address: '0x4200000000000000000000000000000000000010',
      },
      l2ToL1MessagePasser: {
        address: '0x4200000000000000000000000000000000000016',
      },
      multicall3: {
        address: '0xca11bde05977b3631167028862be2a173976ca11',
        blockCreated: 0,
      },
      portal: {
        11155111: {
          address: '0x0d83dab629f0e0F9d36c0Cbc89B69a489f0751bD',
        },
      },
      l1StandardBridge: {
        11155111: {
          address: '0xea58fcA6849d79EAd1f26608855c2D6407d54Ce2',
        },
      },
      disputeGameFactory: {
        11155111: {
          address: '0xeff73e5aa3B9AEC32c659Aa3E00444d20a84394b',
        },
      },
    },
    id: 1301,
    name: 'Unichain Sepolia',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: ['https://sepolia.unichain.org'],
      },
    },
    blockExplorers: {
      default: {
        name: 'Uniscan',
        url: 'https://sepolia.uniscan.xyz',
        apiUrl: 'https://api-sepolia.uniscan.xyz/api',
      },
    },
    testnet: true,
    sourceId: 11155111,
    icon: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_10964_3441)"><path d="M18 0H0V18H18V0Z" fill="#F50DB4"/><path d="M14.9742 8.88585C11.729 8.88585 9.10099 6.24956 9.10099 3H8.87318V8.88585H3V9.11415C6.24521 9.11415 8.87318 11.7505 8.87318 15H9.10099V9.11415H14.9742V8.88585Z" fill="white"/></g><defs><clipPath id="clip0_10964_3441"><rect width="18" height="18" fill="white"/></clipPath></defs></svg>',
    primaryColor: '#F50DB4',
    textColor: '#fff',
  },
]


export default function Page() {
  const params = useParams()
  const id = params.id

  return (
    <>
      <PageTitle name={`networks`} />
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <div className={`__container ${styles.page__container}`} data-width={`medium`}>
          <NetworkDetails id={id} />
        </div>
      </div>
    </>
  )
}
//           .filter((filterItem) => filterItem.id.toString() === id.toString())
const NetworkDetails = ({ id }) => {
  return (
    <>
      {config&&
        config.map((item, i) => {
            return (
              <div key={i} className={`${styles.network}`} title={item.rpcUrls.default.http[0]}>
                <div className={`${styles.network__body} d-f-c flex-row justify-content-between gap-025`} style={{ '--bg-color': `${item.primaryColor}` }}>
                  <div className={`flex flex-column align-items-center justify-content-start gap-050 flex-1`}>
                    <div className={`${styles.network__icon}`} dangerouslySetInnerHTML={{ __html: item.icon }} />
                    <h3>{item.name}</h3>
                    <table>
                      <thead>
                        <tr>
                          <th width="30%">Setting</th>
                          <th>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Name</td>
                          <td>
                            {item.name}
                            {item.testnet && <span className={`lable lable-warning ml-10`}>TESTNET</span>}
                          </td>
                        </tr>
                        <tr>
                          <td>Chain Id</td>
                          <td>{item.id}</td>
                        </tr>
                        <tr>
                          <td>Currency Symbol</td>
                          <td>{item.nativeCurrency.symbol}</td>
                        </tr>
                        <tr>
                          <td>RPC</td>
                          <td>
                            <code>{item.rpcUrls.default.http[0]}</code>
                          </td>
                        </tr>
                        <tr>
                          <td>Block Eplorer</td>
                          <td>
                            <a href={item.blockExplorers.default.url} target="_blank" rel="noopener noreferrer">
                              {item.blockExplorers.default.url} ↗
                            </a>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    <Link href={`/networks`}>&larr; Back to all networks</Link>
                  </div>
                </div>
              </div>
            )
          })}
    </>
  )
}

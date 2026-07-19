/**
 * @file config/contracts.js
 * @description Server-safe chain and contract-address data. API routes and lib/
 * readers import from here instead of config/wagmi so evaluating them never
 * constructs wallet connectors (WalletConnect touches browser-only storage such
 * as indexedDB the moment it is instantiated). config/wagmi re-exports these for
 * client code.
 */

import { arbitrum, base, bsc, celo, lukso, mainnet, monad, monadTestnet } from 'wagmi/chains'
import { defineChain } from 'viem'

// Robinhood Chain (Arbitrum Orbit L2, ETH as native gas token)
export const robinhood = defineChain({
  id: 4663,
  name: 'Robinhood',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: [`https://rpc.mainnet.chain.robinhood.com`],
    },
  },
  blockExplorers: {
    default: {
      name: 'Blockscout',
      url: `https://robinhoodchain.blockscout.com`,
    },
  },
})

// Chains the app runs on — single source of truth for the wagmi config's
// `chains` tuple and for server-side RPC lookups (chain.rpcUrls.default.http).
// L1s first, then L2s.
export const appChains = [mainnet, lukso, bsc, monad, monadTestnet, arbitrum, base, celo, robinhood] //somniaTestnet

export const CONTRACTS = {
  chain1: {
    name: 'ethereum',
    forwarder: '0xA8231e213a85BA0FBEB42F319175f10E2D849352',
    forwarderName: 'HupForwarder',
    hup: '0xd1aEc7Bb7679FA30E74Ab30877FbdF96d51333D4',
    status: '0x130BD13f5A7AcA97cfF4Ed32ac2EbF94197Be88f',
    chat: '',
    followerSystem:'0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA',
    store: '',
    tipper: '0x9a8Daf359280eb03D734530992691888fA33D476',
    trade: '',
    events: '',
  },
  chain42: {
    name: 'lukso',
    forwarder: '0x76d610248ADDd1619c0Bc34F18E5436E38Dc6972',
    forwarderName: 'HupChatForwarder',
    hup: '0xf6eeC4e32a532b23ACC56b72865e79c79877CEc8',
    status: '0xeCF2c230df65F50482c687040b272A808F753849',
    chat: '0x3a98ACd2B8CcBe85121F95BF9F9636A484A80d67',
    followerSystem:'0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA',
    store: '',
    tipper: '0x52A22BEaA2e7d2aC6C0124259b6984f49c56598E',
    trade: '0x4bad88a02d8a4926fE50F69A12A3e095E433CEc0',
    events: '0x29fAdA247735a95Ad92A70890cb21106D12a5E0C',
  },
  chain143: {
    name: 'monad',
    forwarder: '0x09FAf2fddED624958589aD9ca704Bc4C6C232e72',
    forwarderName: 'HupChatForwarder',
    hup: '0x8b76923EA3BFAA8EB29FC58e81E49F3c4Fa9Ba8A',
    status: '0xcDc18688D98Ff84fF5352d1ddDe183De7817Df98',
    chat: '0x09E50a68f63dFFF83924c149268923eeDBCF1B7e',
    followerSystem:'0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA',
    store: '',
    tipper: '0xCf7C449F5dF10E3FD4ae46C25E9B0895C1Be90e4',
    trade: '',
    events: '0x39CB4342C425Cdc8576fa593988E5a4980db9853',
  },
  chain42220: {
    name: 'celo',
    forwarder: '0x46a3dfcb1f4ec29db7f96c0d3962df20e6edb259',
    hup: '0xdda507afa7be1e70b9dceeb3b34c9b886c98ff73',
    status: '0xe7A1F3601b6dCA2F0D5176cd9d8FFA10479D3Ed0',
    chat: '',
    followerSystem:'0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA',
    store: '',
    tipper: '0xbc487be674065E39FeFF468856ce614E0Dec48fb',
    trade: '',
    events: '0x10feacEEDDB387112f9a484EfB2df9FB197934E4',
  },
  chain8453: {
    name: 'base',
    forwarder: '0xae95e44D2642F568D0e0Fc0d60202B55c8764567',
    hup: '0xE401aF10CAa79F9Bb6945C87Ee196503E5DE6BEA',
    status: '0xc9ddc0E09eFa8D3333DFEdFFd68157BC2a9026F3',
    followerSystem:'0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA',
    store: '',
    tipper: '0x01F725975b17dB66DBF26ebAa02bc74F8a433A18',
    trade: '',
    events: '0x6dB2352e9921F46F005449FcA36938e7cb5A29f5',
  },
  chain56: {
    name: 'bnb',
    forwarder: '0xc407722d150c8a65e890096869f8015D90a89EfD',
    hup: '0xA5e73b15c1C3eE477AED682741f0324C6787bbb8',
    status: '0x81c5a8fd5771cB398e2461cEF9Abb2eCD308d4c8',
    followerSystem:'0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA',
    store: '',
    tipper: '0x74AC93C4A4a67f56af9d1Bd3153910D90F802632',
    trade: '',
    events: '0xD479950963A8F87d9Cd44Ad3983C96A5A4b3c14d',
  },
  chain4663: {
    name: 'robinhood',
    forwarder: '0xf5e4d19c9de1323dfF4fd85822Ca7A3582035e76',
    hup: '0x4E6Bab4961Ab53D70745E791FA727993A4221d1F',
    status: '0xc407722d150c8a65e890096869f8015D90a89EfD',
    followerSystem:'0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA',
    chat: '',
    store: '',
    tipper: '0x3EF07D888e4B4d91e5b6c889E6Bdb7A37BE76CDE',
    trade: '',
    events: '0x735A8352036B953F8AC0Ae421DaEf8f2978EcC91',
  },
  chain10143: {
    name: 'monad-testnet',
    forwarder: '0x46a3dfCb1F4ec29dB7F96C0D3962DF20E6EdB259',
    hup: '0xddA507aFA7bE1e70B9dceEB3B34c9B886C98Ff73',
    status: '0xd5f02276c28E1F134BfA0b423381CE740ccb644E',
    community: '0x5D7ebD8ae5A439204A1F1f5f168c7C48AA25d88c',
    followerSystem:'0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA',
    store: '0x85765350FF07802155a35fFf261DFfaAb0ffA366',
    tipper: '0x487aE425f90425a3376F3bC8A016aA1Fb6bec96f',
    trade: '0xC2b7f6eDecE9E5aB04C296a02bf61054487812e5',
    events: '0x4A6D88aBd0fd9049c1adD6757D382c1bb5bbC1D9',
  },
  chain42161: {
    name: 'arbitrum',
    forwarder: '0x41e6D71623FD02633C568342852154D2Cd7DBD0e',
    hup: '0x1EC0B3b802aFE596929a038f40F832EA01eCc281',
    status: '0x2269Fb436d594902e3c38085CBB3f350532531B3',
    followerSystem:'0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA',
    community: '',
    store: '',
    tipper: '0x0Fc1223079367ADC73F9960E48d786705e992e14',
    trade: '',
    events: '0x88C0963857049368470E2851aFf5EDFc2D32346C',
  },
}

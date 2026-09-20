/**
 * @file mcp/src/config.js
 * The chains Hup is deployed on, with the addresses an agent needs to write. Mirrors
 * src/config/contracts.js in the app; keep the two in step when a chain is added.
 */

import { defineChain } from 'viem'
import { arbitrum, base, baseSepolia, bsc, celo, lukso, mainnet, monad } from 'viem/chains'

export const DEFAULT_BASE_URL = 'https://hup.social'

/** LSP26 follower registry: one address on every chain that has it. */
const LSP26 = '0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA'

const robinhood = defineChain({
  id: 4663,
  name: 'Robinhood',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
})

const arc = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io', 'https://rpc.arc-scan.org'] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' } },
})

// viem's defaults refuse keyless server callers on several chains; pin ones that answer.
const pin = (chain, http) => ({ ...chain, rpcUrls: { ...chain.rpcUrls, default: { http } } })

const entry = (chain, slug, hup, forwarder, forwarderName, followerSystem, extra = {}) => ({
  chain,
  id: chain.id,
  slug,
  hup,
  forwarder,
  forwarderName,
  followerSystem,
  testnet: false,
  ...extra,
})

export const CHAINS = [
  entry(
    pin(mainnet, ['https://ethereum-rpc.publicnode.com', ...mainnet.rpcUrls.default.http]),
    'ethereum',
    '0xd1aEc7Bb7679FA30E74Ab30877FbdF96d51333D4',
    '0xA8231e213a85BA0FBEB42F319175f10E2D849352',
    'HupForwarder',
    LSP26,
  ),
  entry(
    pin(lukso, ['https://rpc.mainnet.lukso.network', 'https://42.rpc.thirdweb.com']),
    'lukso',
    '0xf6eeC4e32a532b23ACC56b72865e79c79877CEc8',
    '0xd21EEb8df33D47e80dcf6d3776e6bE702982B112',
    'HupForwarder',
    LSP26,
  ),
  entry(
    pin(bsc, ['https://bsc-rpc.publicnode.com']),
    'bnb',
    '0xA5e73b15c1C3eE477AED682741f0324C6787bbb8',
    '0xc407722d150c8a65e890096869f8015D90a89EfD',
    'HupForwarder',
    LSP26,
  ),
  entry(
    monad,
    'monad',
    '0x8b76923EA3BFAA8EB29FC58e81E49F3c4Fa9Ba8A',
    '0x8466799e31a86a4d51B76154e57B14DcAF9A8756',
    'HupForwarder',
    LSP26,
  ),
  entry(
    arc,
    'arc',
    '0xA5e73b15c1C3eE477AED682741f0324C6787bbb8',
    '0xc407722d150c8a65e890096869f8015D90a89EfD',
    'HupForwarder',
    '',
  ),
  entry(
    pin(arbitrum, ['https://arbitrum-one-rpc.publicnode.com', ...arbitrum.rpcUrls.default.http]),
    'arbitrum',
    '0x1EC0B3b802aFE596929a038f40F832EA01eCc281',
    '0x41e6D71623FD02633C568342852154D2Cd7DBD0e',
    'HupForwarder',
    LSP26,
  ),
  entry(
    pin(base, ['https://base-rpc.publicnode.com', ...base.rpcUrls.default.http]),
    'base',
    '0xE401aF10CAa79F9Bb6945C87Ee196503E5DE6BEA',
    '0xae95e44D2642F568D0e0Fc0d60202B55c8764567',
    'HupForwarder',
    LSP26,
  ),
  entry(
    pin(celo, ['https://celo-rpc.publicnode.com', ...celo.rpcUrls.default.http]),
    'celo',
    '0xdda507afa7be1e70b9dceeb3b34c9b886c98ff73',
    '0x46a3dfcb1f4ec29db7f96c0d3962df20e6edb259',
    'HupForwarder',
    LSP26,
  ),
  entry(
    robinhood,
    'robinhood',
    '0x4E6Bab4961Ab53D70745E791FA727993A4221d1F',
    '0xf5e4d19c9de1323dfF4fd85822Ca7A3582035e76',
    'HupForwarder',
    LSP26,
  ),
  entry(
    pin(baseSepolia, ['https://base-sepolia-rpc.publicnode.com', 'https://sepolia.base.org']),
    'base-sepolia',
    '0xf6b33ecab0fa561300453c1bb1B520Ce544544ae',
    '0x18B86518709a6C0942F3adCD0CD528D1716e0A80',
    'HupChatForwarder',
    '',
    { testnet: true },
  ),
]

const BY_ID = new Map(CHAINS.map((c) => [c.id, c]))
const BY_SLUG = new Map(CHAINS.map((c) => [c.slug, c]))

/**
 * @param {number|string} idOrSlug chain id or slug ("base", "lukso", …)
 * @returns {(typeof CHAINS)[number]}
 */
export function chainEntry(idOrSlug) {
  const key = String(idOrSlug ?? '').trim().toLowerCase()
  const found = BY_ID.get(Number(key)) ?? BY_SLUG.get(key)
  if (!found) {
    throw new Error(`Unknown Hup chain "${idOrSlug}". Known: ${CHAINS.map((c) => `${c.id} (${c.slug})`).join(', ')}`)
  }
  return found
}

export const chainSummary = (c) => ({
  id: c.id,
  slug: c.slug,
  name: c.chain.name,
  native_symbol: c.chain.nativeCurrency.symbol,
  testnet: c.testnet,
  hup: c.hup,
  forwarder: c.forwarder,
  follow_supported: Boolean(c.followerSystem),
  explorer: c.chain.blockExplorers?.default?.url ?? null,
})

export const txUrl = (c, hash) => {
  const base = c.chain.blockExplorers?.default?.url
  return base ? `${base.replace(/\/$/, '')}/tx/${hash}` : null
}

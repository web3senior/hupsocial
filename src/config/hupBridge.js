/**
 * @file config/hupBridge.js
 * @description The Hup bridge: lock on a source chain, claim an LSP7 mirror on LUKSO with a Hup
 * signature, burn on LUKSO, release on the source chain with another. Server-safe (no wallet
 * connectors), so the signer API and the /bridge page read the same addresses and types.
 */

import { parseAbi, zeroAddress } from 'viem'
import { arbitrum, base, bsc, celo, lukso, mainnet, monad, soneium } from 'wagmi/chains'
import { arc, robinhood } from '@/config/contracts'

export const BRIDGE_DESTINATION = lukso
export const NATIVE_TOKEN = zeroAddress
export const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'

// The LUKSO side, where mirrors are claimed and burned.
export const LUKSO_BRIDGE = '0x2190945D28e39eA3000A1061Fa9c0baD46D5eC48'

// One vault per source chain. A chain appears on /bridge only once its vault is set here, and the
// LUKSO bridge must also list it (setVault) before claims from it are accepted.
// `confirmations` is how deep a deposit must be before the signer attests it.
export const BRIDGE_SOURCES = [
  { chain: base, vault: '0x744e42085b8331BfACb212D55042BE9328325BB8', confirmations: 10 },
  { chain: mainnet, vault: '', confirmations: 12 },
  { chain: arbitrum, vault: '', confirmations: 20 },
  { chain: bsc, vault: '', confirmations: 15 },
  { chain: celo, vault: '', confirmations: 10 },
  { chain: soneium, vault: '', confirmations: 10 },
  { chain: monad, vault: '', confirmations: 10 },
  { chain: arc, vault: '', confirmations: 10 },
  { chain: robinhood, vault: '', confirmations: 20 },
].filter(({ vault }) => vault)

// How deep a LUKSO burn must be before the signer attests its release.
export const LUKSO_CONFIRMATIONS = 6

export const sourceFor = (chainId) => BRIDGE_SOURCES.find(({ chain }) => chain.id === Number(chainId))

// Quick picks only; any ERC20 address can be pasted.
export const BRIDGE_TOKENS = {
  [base.id]: [{ symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' }],
  [mainnet.id]: [
    { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
    { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
  ],
  [arbitrum.id]: [{ symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' }],
  [bsc.id]: [{ symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955' }],
}

export const CLAIM_TYPES = {
  Claim: [
    { name: 'sourceChainId', type: 'uint256' },
    { name: 'vault', type: 'address' },
    { name: 'depositNonce', type: 'uint256' },
    { name: 'sourceToken', type: 'address' },
    { name: 'decimals', type: 'uint8' },
    { name: 'name', type: 'string' },
    { name: 'symbol', type: 'string' },
    { name: 'recipient', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'metadata', type: 'bytes' },
  ],
}
export const RELEASE_TYPES = {
  Release: [
    { name: 'burnId', type: 'bytes32' },
    { name: 'token', type: 'address' },
    { name: 'recipient', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
}
export const claimDomain = () => ({ name: 'HupLuksoBridge', version: '1', chainId: lukso.id, verifyingContract: LUKSO_BRIDGE })
export const releaseDomain = (chainId, vault) => ({ name: 'HupBridgeVault', version: '1', chainId: Number(chainId), verifyingContract: vault })

export const vaultAbi = parseAbi([
  'function bridgeVersion() pure returns (uint256)',
  'function owner() view returns (address)',
  'function signer() view returns (address)',
  'function paused() view returns (bool)',
  'function bridgeFee() view returns (uint256)',
  'function maxBridgeFee() view returns (uint256)',
  'function metadataOf(address token) view returns (uint8 decimals,string name,string symbol)',
  'function locked(address) view returns (uint256)',
  'function feesAccrued() view returns (uint256)',
  'function released(bytes32) view returns (bool)',
  'function dailyReleaseBps() view returns (uint16)',
  'function dailyReleaseFloor(address) view returns (uint256)',
  'function releasableToday(address token) view returns (uint256 available,uint256 resetsAt)',
  'function setDailyReleaseBps(uint16 bps)',
  'function setDailyReleaseFloor(address token,uint256 amount)',
  'function deposit(address token,address recipient,uint256 amount) payable returns (uint256)',
  'function depositWithPermit(address token,address recipient,uint256 amount,bytes permitData) payable returns (uint256)',
  'function depositWithPermit2(address token,address recipient,uint256 amount,bytes permitData) payable returns (uint256)',
  'function depositNative(address recipient,uint256 amount) payable returns (uint256)',
  'function release(bytes32 burnId,address token,address recipient,uint256 amount,bytes signature)',
  'function setBridgeFee(uint256 fee)',
  'function withdrawFees(address to,uint256 amount)',
  'function pause()',
  'function unpause()',
  'event Deposited(uint256 indexed nonce,address indexed token,address indexed sender,address recipient,uint256 amount,uint256 fee,uint8 decimals,string name,string symbol)',
  'event Released(bytes32 indexed burnId,address indexed token,address indexed recipient,uint256 amount)',
])

export const luksoBridgeAbi = parseAbi([
  'struct Claim { uint256 sourceChainId; address vault; uint256 depositNonce; address sourceToken; uint8 decimals; string name; string symbol; address recipient; uint256 amount; bytes metadata; }',
  'function bridgeVersion() pure returns (uint256)',
  'function owner() view returns (address)',
  'function paused() view returns (bool)',
  'function vaultOf(uint256) view returns (address)',
  'function burnFee() view returns (uint256)',
  'function maxBurnFee() view returns (uint256)',
  'function feesAccrued() view returns (uint256)',
  'function mirrors(uint256,address) view returns (address token,uint256 scale)',
  'function predictMirror(uint256 sourceChainId,address sourceToken) view returns (address)',
  'function claimed(bytes32) view returns (bool)',
  'function depositId(uint256 sourceChainId,address vault,uint256 nonce) pure returns (bytes32)',
  'function claim(Claim c,bytes signature) returns (address)',
  'function burn(uint256 sourceChainId,address sourceToken,address recipient,uint256 sourceAmount) payable returns (bytes32)',
  'function setVault(uint256 sourceChainId,address vault)',
  'function setMirrorMetadata(uint256 sourceChainId,address sourceToken,bytes metadata)',
  'function setBurnFee(uint256 fee)',
  'function withdrawFees(address to,uint256 amount)',
  'function pause()',
  'function unpause()',
  'event Burned(bytes32 indexed burnId,uint256 indexed sourceChainId,address indexed sourceToken,address sender,address recipient,uint256 amount)',
  'event Claimed(bytes32 indexed depositId,uint256 indexed sourceChainId,address indexed sourceToken,address recipient,uint256 amount)',
])

export const assetAbi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function nonces(address) view returns (uint256)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
  'function PERMIT_TYPEHASH() view returns (bytes32)',
  'function eip712Domain() view returns (bytes1 fields,string name,string version,uint256 chainId,address verifyingContract,bytes32 salt,uint256[] extensions)',
  'function name() view returns (string)',
  'function version() view returns (string)',
])

// Shared client helpers for Uniswap V4 swaps — pool-key probing and UniversalRouter command
// encoding, ported from the hooder project's working v4.js onto viem. V4 has no per-pool
// contracts: every pool lives inside the chain's PoolManager, identified by a
// (currency0, currency1, fee, tickSpacing, hooks) key, and native coin is currency 0x0
// directly — no WNATIVE wrapping anywhere. Probing is hookless: arbitrary third-party hooks run
// arbitrary code, so a pool carrying one is never quoted here.

import { decodeErrorResult, encodeAbiParameters, parseAbi } from 'viem'
import { CONTRACTS } from '@/config/contracts'
import { afterFee, clampFeeBps } from './uniswap'

export const V4_NATIVE = '0x0000000000000000000000000000000000000000'
const NO_HOOKS = V4_NATIVE

/**
 * LPFeeLibrary.DYNAMIC_FEE_FLAG. A pool carrying it lets its hook quote the fee per swap. Kept
 * for key decoding only: every pool this app quotes is static-fee.
 */
export const V4_DYNAMIC_FEE = 0x800000

// UniversalRouter command byte + V4 router action bytes (v4-periphery Actions)
const CMD_V4_SWAP = '0x10'
const CMD_PERMIT2_PERMIT = '0a'
const ACTION_SWAP_EXACT_IN_SINGLE = '06'
const ACTION_SETTLE_ALL = '0c'
const ACTION_TAKE_ALL = '0f'
// v4-periphery Actions.TAKE_PORTION — skims bips of the open delta to a recipient, which is how
// a creator fee rides a v4 route without a contract of our own
const ACTION_TAKE_PORTION = '10'

/**
 * Hookless pool keys probed when quoting a native↔token pair — the four canonical
 * fee/tickSpacing pairs plus 2500/25, the tier Robinhood Chain's meme launches use.
 * A key with no initialized pool just fails its quote inside the multicall batch.
 */
export const V4_PROBE_TIERS = [
  { fee: 100, tickSpacing: 1 },
  { fee: 500, tickSpacing: 10 },
  { fee: 2500, tickSpacing: 25 },
  { fee: 3000, tickSpacing: 60 },
  { fee: 10000, tickSpacing: 200 },
]

/**
 * The pool key for a native↔token pool at one fee tier. Native (0x0) always sorts first,
 * so it is currency0 by construction and "buy token with native" is always zeroForOne.
 */
export const v4PoolKey = (token, tier) => ({
  currency0: V4_NATIVE,
  currency1: token,
  fee: tier.fee,
  tickSpacing: tier.tickSpacing,
  hooks: NO_HOOKS,
})

/**
 * The hookless pool key for a token against whatever asset the chain's coin trades as.
 *
 * Most chains quote against native, which is currency 0x0 and always sorts first — that is what
 * v4PoolKey assumes. But on a chain whose gas coin IS an ERC20 (Circle's Arc, Celo) the coin has
 * a real address, so it can sort either side of the token and the key has to be ordered rather
 * than assumed. Getting that wrong produces a key for a pool that does not exist, which is
 * indistinguishable from there being no pool at all.
 *
 * @param {string} coin The asset the chain's coin trades as: V4_NATIVE, or its ERC20 address.
 * @param {string} token The token being traded.
 * @param {{fee: number, tickSpacing: number}} tier
 */
export const v4PairKey = (coin, token, tier) => {
  const coinFirst = String(coin).toLowerCase() < String(token).toLowerCase()

  return {
    currency0: coinFirst ? coin : token,
    currency1: coinFirst ? token : coin,
    fee: tier.fee,
    tickSpacing: tier.tickSpacing,
    hooks: NO_HOOKS,
  }
}

/**
 * The pool key for a launchpad pool, built from the factory's own constants rather than found
 * by probing — the hook included.
 *
 * This is the one place a hooked pool is quoted, and the reason it is safe is that nothing here
 * is guessed: the hook address comes from the factory the token was launched by, the fee and
 * tick spacing are that factory's immutables, and the quote asset is recorded on the launch.
 * Currencies sort numerically, so native (0x0) is currency0 whenever it is involved.
 *
 * @param {{token: string, quote: string, fee: number|bigint, tickSpacing: number, hook?: string}} launch
 */
export const launchPoolKey = ({ token, quote, fee, tickSpacing, hook }) => {
  const tokenIsCurrency0 = String(token).toLowerCase() < String(quote).toLowerCase()

  return {
    currency0: tokenIsCurrency0 ? token : quote,
    currency1: tokenIsCurrency0 ? quote : token,
    fee: Number(fee),
    tickSpacing: Number(tickSpacing),
    hooks: hook || NO_HOOKS,
  }
}

const SWAP_FIELDS = [
  {
    name: 'poolKey',
    type: 'tuple',
    components: [
      { name: 'currency0', type: 'address' },
      { name: 'currency1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickSpacing', type: 'int24' },
      { name: 'hooks', type: 'address' },
    ],
  },
  { name: 'zeroForOne', type: 'bool' },
  { name: 'amountIn', type: 'uint128' },
  { name: 'amountOutMinimum', type: 'uint128' },
]

const SWAP_STRUCT = [{ type: 'tuple', components: [...SWAP_FIELDS, { name: 'hookData', type: 'bytes' }] }]

// v4-periphery's ExactInputSingleParams grew a per-hop price floor; a router built after that
// change cannot decode the shorter struct, and one built before cannot decode this one. Zero
// is no floor: amountOutMinimum stays the only slippage guard.
const SWAP_STRUCT_MIN_HOP = [
  { type: 'tuple', components: [...SWAP_FIELDS, { name: 'minHopPriceX36', type: 'uint256' }, { name: 'hookData', type: 'bytes' }] },
]

const swapStructFor = (chainId) => (CONTRACTS[`chain${chainId}`]?.univ4RouterMinHopPrice ? SWAP_STRUCT_MIN_HOP : SWAP_STRUCT)

const CURRENCY_AMOUNT = [{ type: 'address' }, { type: 'uint256' }]

// TAKE_PORTION's params: the currency to skim, who receives it, and the share in bips
const TAKE_PORTION = [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }]

/**
 * Builds the UniversalRouter.execute() args for an exact-input single-pool V4 swap.
 * Native in rides as tx value (the router settles it against the pool); token in is pulled
 * from the wallet through Permit2, which the caller must have authorized beforehand.
 *
 * @param {string} token The ERC20 side of the pool.
 * @param {{fee: number, tickSpacing: number}} tier The pool's fee tier.
 * @param {boolean} nativeIn True when paying with the native coin (buy), false when selling.
 * @param {bigint} amountIn Exact input amount in base units.
 * @param {bigint} minOut Minimum acceptable output after slippage.
 * @returns {{commands: `0x${string}`, inputs: `0x${string}`[], value: bigint}}
 */
export const buildV4Swap = (token, tier, nativeIn, amountIn, minOut, options) =>
  buildV4SwapForKey(v4PoolKey(token, tier), nativeIn, amountIn, minOut, options)

/** Permit2's PermitSingle as the router's PERMIT2_PERMIT command decodes it, signature alongside. */
const PERMIT_SINGLE_INPUT = [
  {
    type: 'tuple',
    components: [
      {
        type: 'tuple',
        name: 'details',
        components: [
          { type: 'address', name: 'token' },
          { type: 'uint160', name: 'amount' },
          { type: 'uint48', name: 'expiration' },
          { type: 'uint48', name: 'nonce' },
        ],
      },
      { type: 'address', name: 'spender' },
      { type: 'uint256', name: 'sigDeadline' },
    ],
  },
  { type: 'bytes' },
]

/** EIP-712 types for a Permit2 PermitSingle. The domain is Permit2's own: name "Permit2", no version. */
export const PERMIT2_TYPES = {
  PermitDetails: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint160' },
    { name: 'expiration', type: 'uint48' },
    { name: 'nonce', type: 'uint48' },
  ],
  PermitSingle: [
    { name: 'details', type: 'PermitDetails' },
    { name: 'spender', type: 'address' },
    { name: 'sigDeadline', type: 'uint256' },
  ],
}

export const permit2Domain = (chainId, permit2) => ({ name: 'Permit2', chainId: Number(chainId), verifyingContract: permit2 })

/**
 * @param {{ permit?: { permitSingle: object, signature: `0x${string}` } | null, chainId?: number,
 *   fee?: { recipient: string, bps: number } | null }} [options]
 *   A signed PermitSingle rides ahead of the swap as the router's PERMIT2_PERMIT command, so the
 *   grant Permit2 needs for the router lands in the same transaction instead of one of its own.
 *   The chain picks the swap struct its router was built with.
 *
 *   `fee` skims a portion of the output to a third party before the trader is paid. Its clamp
 *   lives in lib/uniswap.js: TAKE_PORTION trusts whatever bips it is handed, unlike the v3
 *   router, which refuses anything over 100.
 */
export const buildV4SwapForKey = (poolKey, zeroForOne, amountIn, minOut, { permit = null, chainId, fee = null } = {}) => {
  const currencyIn = zeroForOne ? poolKey.currency0 : poolKey.currency1
  const currencyOut = zeroForOne ? poolKey.currency1 : poolKey.currency0

  const feeBps = clampFeeBps(fee?.bps)
  const takesFee = feeBps > 0 && Boolean(fee?.recipient)

  // TAKE_PORTION reads the open delta, so it has to run before TAKE_ALL empties it. What is
  // left for the trader is the quote less that portion — passing the pre-fee minimum to
  // TAKE_ALL would revert every fee-bearing swap on its own slippage guard.
  const actions = takesFee
    ? `0x${ACTION_SWAP_EXACT_IN_SINGLE}${ACTION_SETTLE_ALL}${ACTION_TAKE_PORTION}${ACTION_TAKE_ALL}`
    : `0x${ACTION_SWAP_EXACT_IN_SINGLE}${ACTION_SETTLE_ALL}${ACTION_TAKE_ALL}`

  const params = [
    encodeAbiParameters(swapStructFor(chainId), [
      { poolKey, zeroForOne, amountIn, amountOutMinimum: minOut, minHopPriceX36: 0n, hookData: '0x' },
    ]),
    encodeAbiParameters(CURRENCY_AMOUNT, [currencyIn, amountIn]),
    ...(takesFee ? [encodeAbiParameters(TAKE_PORTION, [currencyOut, fee.recipient, BigInt(feeBps)])] : []),
    encodeAbiParameters(CURRENCY_AMOUNT, [currencyOut, takesFee ? afterFee(minOut, feeBps) : minOut]),
  ]
  const input = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [actions, params])

  const value = currencyIn === V4_NATIVE ? amountIn : 0n
  if (!permit) return { commands: CMD_V4_SWAP, inputs: [input], value }

  return {
    commands: `0x${CMD_PERMIT2_PERMIT}${CMD_V4_SWAP.slice(2)}`,
    inputs: [encodeAbiParameters(PERMIT_SINGLE_INPUT, [permit.permitSingle, permit.signature]), input],
    value,
  }
}

/**
 * What the router can revert with once a command fails: it wraps the failure in
 * ExecutionFailed(index, bytes), so the reason is one decode deeper than viem looks.
 */
const ROUTER_INNER_ERRORS = parseAbi([
  'error ExecutionFailed(uint256 commandIndex, bytes message)',
  'error TransactionDeadlinePassed()',
  'error InvalidSignature()',
  'error InvalidSigner()',
  'error InvalidSignatureLength()',
  'error InvalidContractSignature()',
  'error InvalidNonce()',
  'error SignatureExpired(uint256 signatureDeadline)',
  'error AllowanceExpired(uint256 deadline)',
  'error InsufficientAllowance(uint256 amount)',
  'error V4TooLittleReceived(uint256 minAmountOutReceived, uint256 amountReceived)',
  'error DeltaNotNegative(address currency)',
  'error DeltaNotPositive(address currency)',
  'error CurrencyNotSettled()',
  'error PoolNotInitialized()',
  'error PriceLimitAlreadyExceeded(uint160 sqrtPriceCurrentX96, uint160 sqrtPriceLimitX96)',
  'error WrappedError(address target, bytes4 selector, bytes reason, bytes details)',
  'error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)',
  'error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)',
])

const SIGNATURE_ERRORS = ['InvalidSignature', 'InvalidSigner', 'InvalidSignatureLength', 'InvalidContractSignature']
const FUNDING_ERRORS = ['InsufficientAllowance', 'AllowanceExpired', 'ERC20InsufficientBalance', 'ERC20InsufficientAllowance']

const decodeRevert = (data) => {
  try {
    const { errorName, args } = decodeErrorResult({ abi: ROUTER_INNER_ERRORS, data })
    if (errorName === 'ExecutionFailed') return decodeRevert(args[1]) ?? { errorName, args }
    return { errorName, args }
  } catch {
    return null
  }
}

/**
 * The reason a UniversalRouter.execute simulation or send reverted, in words a buyer can act on,
 * or null when the error is not a decodable revert.
 *
 * @param {unknown} error Whatever viem threw.
 * @param {{symbol?: string}} [options] The asset being spent, for the funding message.
 * @returns {string|null}
 */
export const describeRouterRevert = (error, { symbol = 'tokens' } = {}) => {
  const reverted = error?.walk?.((link) => link?.raw || link?.data?.errorName)
  if (!reverted) return null
  const { raw, data } = reverted
  const decoded =
    (raw && decodeRevert(raw)) || (data?.errorName === 'ExecutionFailed' && decodeRevert(data.args?.[1])) || data
  const name = decoded?.errorName
  if (!name) return null

  if (SIGNATURE_ERRORS.includes(name)) return 'Your wallet’s signature was not accepted. Try again.'
  if (name === 'InvalidNonce' || name === 'SignatureExpired') return 'That approval is out of date. Try again to sign a fresh one.'
  if (FUNDING_ERRORS.includes(name)) return `The ${symbol} could not leave your wallet. Check your balance and try again.`
  if (name === 'Error' && /TRANSFER_FROM_FAILED/.test(String(decoded.args?.[0]))) {
    return `The ${symbol} could not leave your wallet. Check your balance and try again.`
  }
  if (name === 'V4TooLittleReceived') return 'The price moved past your slippage. Try again.'
  if (name === 'TransactionDeadlinePassed') return 'The trade took too long to send. Try again.'
  if (name === 'Error' && decoded.args?.[0]) return `The trade was refused: ${decoded.args[0]}`
  if (name === 'ExecutionFailed') return `The trade was refused (step ${decoded.args?.[0]}, ${String(decoded.args?.[1]).slice(0, 10)}).`
  return `The trade was refused (${name}).`
}

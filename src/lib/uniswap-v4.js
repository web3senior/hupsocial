// Shared client helpers for Uniswap V4 swaps — pool-key probing and UniversalRouter command
// encoding, ported from the hooder project's working v4.js onto viem. V4 has no per-pool
// contracts: every pool lives inside the chain's PoolManager, identified by a
// (currency0, currency1, fee, tickSpacing, hooks) key, and native coin is currency 0x0
// directly — no WNATIVE wrapping anywhere. Probing is hookless, and a Hup Launch pool is an
// ordinary hookless pool too: its key is built from the factory's constants rather than probed.
// Arbitrary third-party hooks run arbitrary code and are never probed.

import { encodeAbiParameters } from 'viem'

export const V4_NATIVE = '0x0000000000000000000000000000000000000000'
const NO_HOOKS = V4_NATIVE

/**
 * LPFeeLibrary.DYNAMIC_FEE_FLAG. A pool carrying it lets its hook quote the fee per swap. Kept
 * for key decoding only: Hup Launch pools are static-fee and hookless.
 */
export const V4_DYNAMIC_FEE = 0x800000

// UniversalRouter command byte + V4 router action bytes (v4-periphery Actions)
const CMD_V4_SWAP = '0x10'
const ACTION_SWAP_EXACT_IN_SINGLE = '06'
const ACTION_SETTLE_ALL = '0c'
const ACTION_TAKE_ALL = '0f'

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
 * The pool key for a Hup Launch — an ordinary hookless pool at a canonical fee tier, differing
 * from the probes above only in being priced against whatever quote asset it launched with rather
 * than native. Currencies sort numerically, and native (0x0) always sorts first.
 *
 * Hookless is what makes a launch routable: aggregators and Hup's own swap page both probe the
 * standard tiers, and a pool carrying a hook or the dynamic-fee flag is invisible to them.
 *
 * @param {{token: string, quote: string, fee: number, tickSpacing: number}} launch
 */
export const launchPoolKey = ({ token, quote, fee, tickSpacing }) => {
  const tokenIsCurrency0 = String(token).toLowerCase() < String(quote).toLowerCase()

  return {
    currency0: tokenIsCurrency0 ? token : quote,
    currency1: tokenIsCurrency0 ? quote : token,
    fee: Number(fee),
    tickSpacing: Number(tickSpacing),
    hooks: NO_HOOKS,
  }
}

const SWAP_STRUCT = [
  {
    type: 'tuple',
    components: [
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
      { name: 'hookData', type: 'bytes' },
    ],
  },
]

const CURRENCY_AMOUNT = [{ type: 'address' }, { type: 'uint256' }]

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
export const buildV4Swap = (token, tier, nativeIn, amountIn, minOut) =>
  buildV4SwapForKey(v4PoolKey(token, tier), nativeIn, amountIn, minOut)

/**
 * The same encoding for an arbitrary pool key, so a launch pool built from the factory's
 * constants swaps through the one router the swap page already uses.
 *
 * @param {Object} poolKey A full v4 pool key.
 * @param {boolean} zeroForOne True when spending currency0 to receive currency1.
 * @param {bigint} amountIn Exact input amount in base units.
 * @param {bigint} minOut Minimum acceptable output after slippage.
 */
export const buildV4SwapForKey = (poolKey, zeroForOne, amountIn, minOut) => {
  const currencyIn = zeroForOne ? poolKey.currency0 : poolKey.currency1
  const currencyOut = zeroForOne ? poolKey.currency1 : poolKey.currency0

  const actions = `0x${ACTION_SWAP_EXACT_IN_SINGLE}${ACTION_SETTLE_ALL}${ACTION_TAKE_ALL}`
  const params = [
    encodeAbiParameters(SWAP_STRUCT, [
      { poolKey, zeroForOne, amountIn, amountOutMinimum: minOut, hookData: '0x' },
    ]),
    encodeAbiParameters(CURRENCY_AMOUNT, [currencyIn, amountIn]),
    encodeAbiParameters(CURRENCY_AMOUNT, [currencyOut, minOut]),
  ]
  const input = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [actions, params])

  return { commands: CMD_V4_SWAP, inputs: [input], value: currencyIn === V4_NATIVE ? amountIn : 0n }
}

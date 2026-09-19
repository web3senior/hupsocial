// Shared client helpers for token swaps — v3 fee-tier probing, path encoding, and
// decimals-aware amount formatting. Quoting and execution go through the chain's official
// QuoterV2 / SwapRouter02 (config/contracts.js univ3Quoter / univ3Router), the exact same
// stack every configured chain's DEX registry was verified against.

/**
 * The standard v3 fee tiers. Every one is probed when quoting — a tier with no pool just
 * fails its call inside the multicall batch, and the best surviving quote wins. That is
 * the same best-of-all-tiers race the v4 side runs.
 */
export const FEE_TIERS = [100, 500, 3000, 10000]

// SwapRouter02's Constants.ADDRESS_THIS — the router itself, as an intermediate recipient
// so a native-out swap's WNATIVE can be unwrapped to coin in the same multicall
export const ROUTER_ADDRESS_THIS = '0x0000000000000000000000000000000000000002'

/**
 * Encodes a v3 swap path: token, fee, token [, fee, token…] packed with 3-byte fees.
 *
 * @param {string[]} tokens Hop token addresses, in order.
 * @param {number[]} fees Fee tier between each consecutive token pair (`tokens.length - 1`).
 * @returns {`0x${string}`} The packed path bytes exactInput / quoteExactInput expect.
 */
export const encodePath = (tokens, fees) => {
  if (tokens.length !== fees.length + 1) throw new Error('encodePath: need one fee per hop')

  let path = '0x'
  for (let i = 0; i < fees.length; i++) {
    path += tokens[i].slice(2) + fees[i].toString(16).padStart(6, '0')
  }
  return path + tokens[tokens.length - 1].slice(2)
}

const groupFormat = new Intl.NumberFormat('en-US')

/**
 * Formats a base-unit amount as a plain decimal string — grouped thousands, never
 * exponential notation, capped at `maxSig` significant digits. The launch.js formatters
 * assume 18 decimals; swap amounts also come in 6-decimal flavors (USDC), so this one
 * takes decimals explicitly.
 *
 * @param {bigint|string} value Amount in base units.
 * @param {number} decimals The token's decimals.
 * @param {number} maxSig Significant digits to keep.
 */
export const formatAmount = (value, decimals = 18, maxSig = 7) => {
  const amount = BigInt(value ?? 0)
  if (amount === 0n) return '0'

  const negative = amount < 0n
  const absolute = negative ? -amount : amount
  const base = 10n ** BigInt(decimals)
  const whole = absolute / base
  const fraction = String(absolute % base).padStart(decimals, '0')

  let out
  if (whole === 0n) {
    const firstSignificant = fraction.search(/[1-9]/)
    const kept = fraction.slice(firstSignificant, firstSignificant + maxSig).replace(/0+$/, '')
    out = kept ? `0.${'0'.repeat(firstSignificant)}${kept}` : '0'
  } else {
    const digitsLeft = Math.max(maxSig - String(whole).length, 0)
    const kept = fraction.slice(0, digitsLeft).replace(/0+$/, '')
    out = kept ? `${groupFormat.format(whole)}.${kept}` : groupFormat.format(whole)
  }

  return negative ? `-${out}` : out
}

// Basis-point denominator, shared by the slippage guard and the creator fee.
const BPS = 10_000n

/**
 * The v3 router's own ceiling on a fee sweep: PeripheryPaymentsWithFee reverts above 100 bips.
 * v4's TAKE_PORTION has no such guard, so this is the app-wide clamp for both — a post's JSON
 * is author-controlled, and an unclamped fee on a v4 route would skim whatever it liked.
 */
export const MAX_FEE_BPS = 100

/** Applies a slippage tolerance to a quote, producing the router's amountOutMinimum. */
export const withSlippage = (amount, toleranceBps = 100) => (BigInt(amount ?? 0) * (BPS - BigInt(toleranceBps))) / BPS

/** A fee rate as the routers will actually charge it: a whole number of bips, 0…100. */
export const clampFeeBps = (bps) => Math.max(0, Math.min(MAX_FEE_BPS, Math.floor(Number(bps) || 0)))

/** What is left of an output once the fee sweep has taken its portion. */
export const afterFee = (amount, feeBps) => (BigInt(amount ?? 0) * (BPS - BigInt(clampFeeBps(feeBps)))) / BPS

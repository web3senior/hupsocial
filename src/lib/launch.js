// Shared client helpers for Hup Launch — Uniswap pool price math, the pre-launch buy estimate,
// and the tiny-number formatting memecoin prices need. Used by the in-post card, the launch
// page, the directory, and the composer's create dialog.
//
// One-phase launches trade as ordinary Uniswap v3 swaps, so there is no settlement math to
// mirror here: quotes come from the chain's QuoterV2 and can never disagree with execution.
// What remains BigInt-exact is price derivation from sqrtPriceX96 and the opening-buy estimate,
// which prices against the launch position's closed form before the pool exists.

export const FEE_DENOMINATOR = 10_000n
export const WAD = 10n ** 18n
const Q96 = 2n ** 96n
const Q192 = 2n ** 192n

/** Fixed supply minted per launch, matching HupLaunch.TOTAL_SUPPLY. All of it goes in the pool. */
export const TOTAL_SUPPLY = 1_000_000_000n * WAD

/** The v3 fee tier every launch pool uses, matching HupLaunch.POOL_FEE (0.30%). */
export const POOL_FEE = 3000
export const POOL_FEE_BPS = 30n

/**
 * Price of one whole launch token in native wei, from a pool's sqrtPriceX96.
 *
 * v3 defines price as token1-per-token0 in raw units: (sqrtPriceX96 / 2⁹⁶)². When the launch
 * token is token0 that is already native-per-token; when it is token1 the ratio inverts. Both
 * both paths stay in BigInt — a float here would wobble the last digits of a 1e-9 price.
 *
 * @param {bigint|string} sqrtPriceX96 The pool's current sqrt price.
 * @param {boolean} tokenIsToken0 True when the launch token sorts below WNATIVE.
 * @returns {bigint} Wei per whole token.
 */
export const sqrtPriceToPriceWei = (sqrtPriceX96, tokenIsToken0) => {
  const sqrt = BigInt(sqrtPriceX96 ?? 0)
  if (sqrt === 0n) return 0n

  return tokenIsToken0 ? (sqrt * sqrt * WAD) / Q192 : (Q192 * WAD) / (sqrt * sqrt)
}

/** Fully diluted value in wei: price times the full 1B supply. */
export const marketCapWei = (priceWei) => (BigInt(priceWei ?? 0) * TOTAL_SUPPLY) / WAD

/**
 * Estimates the native cost of buying `tokensWanted` at launch, for the "buy pre-launch"
 * presets — quoted before the pool exists, so QuoterV2 can't answer.
 *
 * The launch position is single-sided liquidity from the opening price upward, which behaves
 * exactly like a constant-product curve whose virtual reserve equals the opening supply value:
 * cost = V₀ · Δ / (S − Δ), grossed up for the pool fee. Ceiling-rounded so the estimate lands
 * at or above the real fill rather than a wei short.
 *
 * @param {bigint|string} openingSupplyValue The factory's openingSupplyValue (launch FDV in wei).
 * @param {bigint} tokensWanted Target tokens out, in base units.
 * @returns {bigint} Estimated gross native input, in wei.
 */
export const estimateOpeningBuy = (openingSupplyValue, tokensWanted) => {
  const value = BigInt(openingSupplyValue ?? 0)
  const target = BigInt(tokensWanted ?? 0)
  if (value <= 0n || target <= 0n || target >= TOTAL_SUPPLY) return 0n

  const denominator = TOTAL_SUPPLY - target
  const swapCost = (value * target + denominator - 1n) / denominator

  const keptBps = FEE_DENOMINATOR - POOL_FEE_BPS
  return (swapCost * FEE_DENOMINATOR + keptBps - 1n) / keptBps
}

/** Applies a slippage tolerance to a quote, producing the router's amountOutMinimum. */
export const withSlippage = (amount, toleranceBps = 100) =>
  (BigInt(amount ?? 0) * (FEE_DENOMINATOR - BigInt(toleranceBps))) / FEE_DENOMINATOR

const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉'
const toSubscript = (value) =>
  String(value)
    .split('')
    .map((digit) => SUBSCRIPT_DIGITS[Number(digit)])
    .join('')

const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 })

/**
 * Formats a wei price for display. Memecoin prices routinely have eight or more leading zeros,
 * where both fixed notation ("0.00000000125") and Intl's scientific notation read badly in a
 * feed, so runs of four or more zeros collapse to the subscript form every DEX screener uses:
 * 0.0₈125.
 *
 * @param {bigint|string} wei Price in wei.
 * @param {number} significant Significant digits to keep after the leading zeros.
 */
export const formatPrice = (wei, significant = 4) => {
  const value = BigInt(wei ?? 0)
  if (value === 0n) return '0'

  const whole = value / WAD
  const fraction = String(value % WAD).padStart(18, '0')

  if (whole > 0n) {
    const trimmed = fraction.slice(0, significant).replace(/0+$/, '')
    return trimmed ? `${compactNumber.format(whole)}.${trimmed}` : compactNumber.format(whole)
  }

  const firstSignificant = fraction.search(/[1-9]/)
  const digits = fraction.slice(firstSignificant, firstSignificant + significant).replace(/0+$/, '') || '0'

  if (firstSignificant < 4) return `0.${'0'.repeat(firstSignificant)}${digits}`

  return `0.0${toSubscript(firstSignificant)}${digits}`
}

/**
 * Same subscript notation as formatPrice, but for a plain decimal Number rather than wei — for
 * chart axes, where the plotting library hands back Numbers it scaled itself. Prefer formatPrice
 * anywhere the exact wei value is still in hand.
 */
export const formatDecimal = (value, significant = 3) => {
  const number = Number(value)
  if (!Number.isFinite(number) || number === 0) return '0'

  // toPrecision/toExponential throw outside 1–100, and chart libraries love to hand a
  // second positional argument to a formatter, so clamp rather than trust the caller
  const digitCount = Math.min(Math.max(Math.trunc(significant) || 3, 1), 20)
  if (Math.abs(number) >= 0.001) return String(Number(number.toPrecision(digitCount)))

  const [mantissa, exponent] = number.toExponential(digitCount - 1).split('e')
  const leadingZeros = -Number(exponent) - 1
  const digits = mantissa.replace('-', '').replace('.', '').replace(/0+$/, '') || '0'

  return `${number < 0 ? '-' : ''}0.0${toSubscript(leadingZeros)}${digits}`
}

/** Compact whole-token count for supply and holdings — "1.2M", "800K". */
export const formatTokenAmount = (baseUnits) => compactNumber.format(BigInt(baseUnits ?? 0) / WAD)

/** Compact native value with up to 4 decimals — for market cap and volume readouts. */
export const formatNative = (wei) => {
  const value = BigInt(wei ?? 0)
  if (value === 0n) return '0'
  if (value < WAD / 10_000n) return '<0.0001'

  const whole = value / WAD
  if (whole >= 1000n) return compactNumber.format(whole)

  return (Number(value) / 1e18).toLocaleString('en', { maximumFractionDigits: 4 })
}

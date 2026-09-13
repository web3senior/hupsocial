// Shared client helpers for Hup Launch — Uniswap pool price math, the pre-launch buy estimate,
// and the tiny-number formatting memecoin prices need. Used by the in-post card, the launch
// page, the directory, and the composer's create dialog.
//
// One-phase launches trade as ordinary Uniswap v3 swaps, so there is no settlement math to
// mirror here: quotes come from the chain's QuoterV2 and can never disagree with execution.
// What remains BigInt-exact is price derivation from sqrtPriceX96 and the opening-buy estimate,
// which prices against the launch position's closed form before the pool exists.

import launchAbi from '@/abis/HupLaunch.json'

export const FEE_DENOMINATOR = 10_000n
export const WAD = 10n ** 18n
const Q96 = 2n ** 96n
const Q192 = 2n ** 192n


const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const LAUNCH_CREATED_EVENT = launchAbi.find((entry) => entry.type === 'event' && entry.name === 'LaunchCreated')

/**
 * Reads one launch straight off the chain, shaped like the indexed row the API serves.
 *
 * The indexer trails a fresh launch by seconds or minutes, and "this doesn't exist" is the worst
 * thing to tell someone who just paid to create it. Everything the page needs is onchain: the
 * factory holds the launch record, and the creation log carries the name, ticker and metadata CID
 * that never touch storage. Trade history stays empty until the indexer catches up, which is
 * honest — there are no trades yet.
 *
 * @returns {Promise<Object|null>} An API-shaped row with `pending: true`, or null if no such launch.
 */
export const readLaunchOnchain = async ({ client, launchAddress, networkId, launchId }) => {
  if (!client || !launchAddress || !launchId) return null

  const launch = await client
    .readContract({ address: launchAddress, abi: launchAbi, functionName: 'getLaunch', args: [BigInt(launchId)] })
    .catch(() => null)

  if (!launch || !launch.creator || launch.creator === ZERO_ADDRESS) return null

  // Name, ticker and the metadata reference are emitted, never stored — so they come from the log
  const logs = await client
    .getLogs({
      address: launchAddress,
      event: LAUNCH_CREATED_EVENT,
      args: { launchId: BigInt(launchId) },
      fromBlock: launch.createdBlock,
      toBlock: launch.createdBlock,
    })
    .catch(() => [])

  const created = logs[0]?.args ?? {}
  const tokenIsCurrency0 = String(launch.token).toLowerCase() < String(launch.quote).toLowerCase()
  const openingPrice = created.sqrtPriceX96 ? sqrtPriceToPriceWei(created.sqrtPriceX96, tokenIsCurrency0) : 0n

  // The metadata document holds the description and image the creator wrote in the dialog
  let meta = {}
  const metadataCid = typeof created.metadata === 'string' ? created.metadata.replace(/^ipfs:\/\//, '') : ''
  if (metadataCid) {
    meta = await fetch(`/api/ipfs/object?cid=${encodeURIComponent(metadataCid)}`)
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}))
  }

  return {
    network_id: networkId,
    launch_id: String(launchId),
    wallet_address: launch.creator,
    token: launch.token,
    pool_id: launch.poolId,
    quote: launch.quote,
    position_token_id: String(launch.positionTokenId),
    name: created.name || meta.name || 'Untitled',
    symbol: created.symbol || meta.symbol || '',
    creator_share_bps: Number(launch.creatorShareBps ?? 0),
    opening_price: String(openingPrice),
    price: String(openingPrice),
    metadata_cid: metadataCid || null,
    description: typeof meta.description === 'string' ? meta.description : null,
    image_cid: typeof meta.image === 'string' ? meta.image : null,
    hidden: 0,
    trade_count: 0,
    volume_native: '0',
    holder_count: 0,
    last_trade_at: null,
    created_at: String(launch.createdAt),
    created_block: String(launch.createdBlock),
    tx_hash: logs[0]?.transactionHash ?? null,
    display_name: null,
    profile_image: null,
    // Tells the page this came from the chain rather than the index, so it can say so
    pending: true,
  }
}

/** Fixed supply minted per launch, matching HupLaunch.TOTAL_SUPPLY. All of it goes in the pool. */
export const TOTAL_SUPPLY = 1_000_000_000n * WAD


/**
 * Price of one whole launch token in the quote asset's base units, from a pool's sqrtPriceX96.
 *
 * Uniswap defines price as currency1-per-currency0 in raw units: (sqrtPriceX96 / 2⁹⁶)². When the launch
 * token is token0 that is already quote-per-token; when it is token1 the ratio inverts. Both
 * both paths stay in BigInt — a float here would wobble the last digits of a 1e-9 price.
 *
 * The result carries the quote asset's own precision, so a USDC-quoted launch prices in 1e6 units
 * and a native one in wei. Everything downstream that renders or converts it takes those decimals.
 *
 * @param {bigint|string} sqrtPriceX96 The pool's current sqrt price.
 * @param {boolean} tokenIsToken0 True when the launch token sorts below the quote asset.
 * @returns {bigint} Quote base units per whole token.
 */
export const sqrtPriceToPriceWei = (sqrtPriceX96, tokenIsToken0) => {
  const sqrt = BigInt(sqrtPriceX96 ?? 0)
  if (sqrt === 0n) return 0n

  return tokenIsToken0 ? (sqrt * sqrt * WAD) / Q192 : (Q192 * WAD) / (sqrt * sqrt)
}

/** Fully diluted value in quote base units: price times the full 1B supply. */
export const marketCapWei = (priceWei) => (BigInt(priceWei ?? 0) * TOTAL_SUPPLY) / WAD

/**
 * Estimates the cost of buying `tokensWanted` at launch, for the "buy pre-launch" presets —
 * quoted before the pool exists, so QuoterV2 can't answer.
 *
 * The launch position is single-sided liquidity from the opening price upward, which behaves
 * exactly like a constant-product curve whose virtual reserve equals the opening supply value:
 * cost = V₀ · Δ / (S − Δ), grossed up for the pool fee. Ceiling-rounded so the estimate lands
 * at or above the real fill rather than a wei short.
 *
 * Decimal-agnostic: the closed form is a ratio of raw units, so passing the factory's opening
 * value for whichever asset the launch is quoted in returns a cost in that same asset's units.
 *
 * @param {bigint|string} openingSupplyValue The factory's opening value for the quote asset —
 *   `openingSupplyValue` for a native launch, `quoteOpeningValue(quote)` for an ERC20 one.
 * @param {bigint} tokensWanted Target tokens out, in base units.
 * @param {bigint|number} feeHundredthsOfBip The pool fee the buy will actually pay. The opening
 *   buy is exempt from the launch tax but still pays the base fee, so this is the factory's
 *   `baseFee` — in v4 units, where 10000 is 1%.
 * @returns {bigint} Estimated gross input, in the quote asset's base units.
 */
export const estimateOpeningBuy = (openingSupplyValue, tokensWanted, feeHundredthsOfBip = 10_000) => {
  const value = BigInt(openingSupplyValue ?? 0)
  const target = BigInt(tokensWanted ?? 0)
  if (value <= 0n || target <= 0n || target >= TOTAL_SUPPLY) return 0n

  const denominator = TOTAL_SUPPLY - target
  const swapCost = (value * target + denominator - 1n) / denominator

  // The fee comes off the input, so gross it up rather than netting it out
  const FEE_SCALE = 1_000_000n
  const kept = FEE_SCALE - BigInt(feeHundredthsOfBip ?? 0)
  if (kept <= 0n) return 0n

  return (swapCost * FEE_SCALE + kept - 1n) / kept
}


/**
 * The creator fee, in the two units it lives in.
 *
 * What the contract stores is a share of the fees the pool COLLECTS. What a creator wants to know
 * is what they earn per buy, so the dialog talks in basis points of volume and converts on the way
 * in. The bridge between the two is whatever the pool charges, which for a launch pool is the
 * factory's static LAUNCH_FEE tier, so a creator's cut of volume is the same on every trade.
 * Quoted here against that fee, in v4's hundredths-of-a-bip units.
 */
export const creatorShareFromVolumeBps = (volumeBps, feeHundredthsOfBip = 10_000) => {
  const poolFeeBps = Number(feeHundredthsOfBip ?? 0) / 100
  if (!poolFeeBps || !Number(volumeBps)) return 0
  return Math.round((Number(volumeBps) * 10_000) / poolFeeBps)
}

/** The inverse: what a stored share works out to per buy, in basis points of volume. */
export const volumeBpsFromCreatorShare = (shareBps, feeHundredthsOfBip = 10_000) => {
  const poolFeeBps = Number(feeHundredthsOfBip ?? 0) / 100
  return Math.round((Number(shareBps ?? 0) * poolFeeBps) / 10_000)
}

/** Basis points as the percentage a creator reads on the card: 10 → "0.1%". */
export const formatVolumeBps = (volumeBps) =>
  `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(volumeBps ?? 0) / 100)}%`

/**
 * Percentage move between two prices, as a number.
 *
 * Both sides arrive as raw base-unit strings and can be astronomically far apart in scale, so the
 * ratio is taken inside BigInt and only then handed to a float — a launch priced at a few wei
 * would otherwise round its whole move away on the way out.
 */
export const changePct = (current, baseline) => {
  try {
    const now = BigInt(current ?? 0)
    const then = BigInt(baseline ?? 0)
    if (then === 0n) return null
    return Number(((now - then) * 1_000_000n) / then) / 10_000
  } catch {
    return null
  }
}

const changeFormat = new Intl.NumberFormat(undefined, {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  // A move is read against its neighbours in a column, so the sign is always printed rather than
  // left for the reader to infer from a colour they may not be able to separate
  signDisplay: 'always',
})

// A fresh token can genuinely move six figures in a day. Two decimals on "+306,989.36%" is
// precision nobody reads and four characters more than the column has, so past a thousand
// percent the magnitude is the only part that still means anything.
const changeCompactFormat = new Intl.NumberFormat(undefined, {
  style: 'percent',
  notation: 'compact',
  maximumFractionDigits: 1,
  signDisplay: 'always',
})

/** A move as a table reads it: "+19.30%", "−24.31%", "+0.00%", "+307K%". */
export const formatChangePct = (value) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const format = Math.abs(value) >= 1000 ? changeCompactFormat : changeFormat
  return format.format(value / 100)
}

const countFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })

/** A tally, grouped: 4267 → "4,267". */
export const formatCount = (value) => countFormat.format(Number(value ?? 0))

/** Decimal string to base units at any precision, without pulling viem into this module. */
const parseUnits = (value, decimals = 18) => {
  const [whole, fraction = ''] = String(value).trim().split('.')
  const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals)
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(padded || '0')
}

/**
 * Dollar conversions for the trading surfaces.
 *
 * A launch's price is exact BigInt base units of the quote asset per whole token, but the quote
 * asset's own dollar price is a float from a feed. So these deliberately return numbers for
 * display and BigInt only where an amount is about to be spent — never mixing the two in one value.
 *
 * Every one of them takes the quote asset's decimals, because a launch is not necessarily priced
 * in the chain's native coin: USDC is 6 on most chains and 18 on BNB, WBTC is 8. The launch token
 * itself is always 18, so only the quote side is ever parameterised. The default keeps native and
 * every 18-decimal quote reading exactly as before.
 */

/** Base units of the quote asset worth of a dollar amount. */
export const usdToQuoteWei = (usd, quoteUsd, decimals = 18) => {
  const dollars = Number(usd)
  const rate = Number(quoteUsd)
  if (!Number.isFinite(dollars) || !Number.isFinite(rate) || rate <= 0 || dollars <= 0) return 0n

  try {
    return parseUnits((dollars / rate).toFixed(decimals), decimals)
  } catch {
    return 0n
  }
}

/** Dollar value of an amount of the quote asset. */
export const quoteWeiToUsd = (wei, quoteUsd, decimals = 18) => {
  const rate = Number(quoteUsd)
  if (!Number.isFinite(rate) || rate <= 0) return null
  return (Number(BigInt(wei ?? 0)) / 10 ** decimals) * rate
}

/**
 * Dollar value of a token balance, priced off the pool.
 *
 * The intermediate is quote base units, which the price already carries — so the division is by
 * the token's WAD, not the quote's units, and only the final conversion needs the decimals.
 */
export const tokenBaseToUsd = (baseUnits, priceWei, quoteUsd, decimals = 18) =>
  quoteWeiToUsd((BigInt(baseUnits ?? 0) * BigInt(priceWei ?? 0)) / WAD, quoteUsd, decimals)

/** Token base units a dollar amount buys at the current price. */
export const usdToTokenBase = (usd, priceWei, quoteUsd, decimals = 18) => {
  const price = BigInt(priceWei ?? 0)
  if (price <= 0n) return 0n

  const quoteWei = usdToQuoteWei(usd, quoteUsd, decimals)
  return (quoteWei * WAD) / price
}

const usdFormat = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const usdSmallFormat = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', maximumSignificantDigits: 3 })

const usdCompactFormat = new Intl.NumberFormat('en', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})

/** Dollars at ticker width — $915.9k rather than $915,900.00. */
export const formatUsdCompact = (value) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null
  return usdCompactFormat.format(Number(value))
}

/** Dollars, dropping to significant digits when the amount is smaller than a cent. */
export const formatUsd = (value) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null
  const amount = Number(value)
  if (amount !== 0 && Math.abs(amount) < 0.01) return usdSmallFormat.format(amount)
  return usdFormat.format(amount)
}

/**
 * Dollars for a column of them: compact from four figures up, exact below.
 *
 * Compact notation only earns its keep once the digits it hides are noise. Below a thousand it
 * rounds away the cents that are the whole number — $16.6 for what is really $16.62.
 */
export const formatUsdFigure = (value) =>
  value === null || value === undefined ? null : Math.abs(value) >= 1000 ? formatUsdCompact(value) : formatUsd(value)

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
 * @param {bigint|string} wei Price in the quote asset's base units, per whole token.
 * @param {number} significant Significant digits to keep after the leading zeros.
 * @param {number} decimals The quote asset's decimals — 6 for most USDC, 8 for WBTC.
 */
export const formatPrice = (wei, significant = 4, decimals = 18) => {
  const value = BigInt(wei ?? 0)
  if (value === 0n) return '0'

  const units = 10n ** BigInt(decimals)
  const whole = value / units
  const fraction = String(value % units).padStart(decimals, '0')

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
 *
 * @param {number} value The number to format.
 * @param {number} significant Significant digits to keep after the leading zeros.
 * @param {Object} [options]
 * @param {boolean} [options.pad] Keep trailing zeros, so every label in a run is the same width.
 *   Lightweight Charts sizes the price scale from the first and last tick only, so a trimmed
 *   run ("0.0₈1" at the ends, "0.0₈1002" in the middle) sizes the axis too narrow and clips.
 */
export const formatDecimal = (value, significant = 3, { pad = false } = {}) => {
  const number = Number(value)
  if (!Number.isFinite(number) || number === 0) return '0'

  // toPrecision/toExponential throw outside 1–100, and chart libraries love to hand a
  // second positional argument to a formatter, so clamp rather than trust the caller
  const digitCount = Math.min(Math.max(Math.trunc(significant) || 3, 1), 20)
  if (Math.abs(number) >= 0.001) {
    if (!pad) return String(Number(number.toPrecision(digitCount)))
    // toFixed rather than toPrecision: past 21 digits toPrecision switches to exponential
    const decimals = Math.min(Math.max(digitCount - 1 - Math.floor(Math.log10(Math.abs(number))), 0), 100)
    return number.toFixed(decimals)
  }

  const [mantissa, exponent] = number.toExponential(digitCount - 1).split('e')
  const leadingZeros = -Number(exponent) - 1
  const significantDigits = mantissa.replace('-', '').replace('.', '')
  const digits = (pad ? significantDigits : significantDigits.replace(/0+$/, '')) || '0'

  return `${number < 0 ? '-' : ''}0.0${toSubscript(leadingZeros)}${digits}`
}

/** Compact whole-token count for supply and holdings — "1.2M", "800K". */
export const formatTokenAmount = (baseUnits) => compactNumber.format(BigInt(baseUnits ?? 0) / WAD)

/**
 * Compact quote-asset amount with up to 4 decimals — for market cap and volume readouts.
 *
 * @param {bigint|string} amount Base units of the quote asset.
 * @param {number} decimals The quote asset's decimals.
 */
export const formatQuote = (amount, decimals = 18) => {
  const value = BigInt(amount ?? 0)
  if (value === 0n) return '0'

  const units = 10n ** BigInt(decimals)
  if (value < units / 10_000n) return '<0.0001'

  const whole = value / units
  if (whole >= 1000n) return compactNumber.format(whole)

  return (Number(value) / 10 ** decimals).toLocaleString('en', { maximumFractionDigits: 4 })
}

/** The same, for the chain's native coin — what every non-launch surface reads. */
export const formatNative = (wei) => formatQuote(wei, 18)

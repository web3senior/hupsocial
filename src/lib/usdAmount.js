/**
 * @file lib/usdAmount.js
 * @description Turning a base-unit token amount plus a dollar rate into the figure printed
 * beside it.
 *
 * The market routes send a rate per whole token rather than a converted amount per row (see
 * api/v1/nfts/offers and .../tokens/[tokenId]), so every surface that renders a price does the
 * same two steps: scale by the token's decimals, multiply by the rate. Doing that in one place
 * is what keeps a $3.10 offer from reading as $3.10 in the offer book and $3.0999 in the card
 * above it.
 *
 * Absent rates are the normal case, not a failure: testnets have no market price and neither do
 * unlisted ERC20s. Everything here returns null for them, and callers render nothing rather than
 * a zero — "$0.00" is a claim about a token's worth that nobody made.
 */

import { formatUnits } from 'viem'

// Sub-cent prices are common on the tokens this app trades — a memecoin bid rounded to two
// decimals reads as "$0.00", which is worse than no figure at all. Below a cent, switch to
// significant digits so the number keeps its meaning.
const USD_FORMAT = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' })
const USD_SMALL_FORMAT = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumSignificantDigits: 2,
})

// Past six figures the cents are noise in a column that has to stay narrow
const USD_LARGE_FORMAT = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})

/**
 * What a base-unit amount is worth, in dollars.
 * @param {string|number|bigint|null} amount Amount in base units.
 * @param {number|null|undefined} decimals The token's decimals.
 * @param {number|null|undefined} rate Dollars per whole token, from a route's `usd` map.
 * @returns {number|null} Null when any input is missing or unparseable.
 */
export function usdValue(amount, decimals, rate) {
  if (amount === null || amount === undefined || decimals === null || decimals === undefined || !rate) return null

  try {
    return Number(formatUnits(BigInt(amount), Number(decimals))) * Number(rate)
  } catch {
    return null
  }
}

/**
 * A dollar figure as a reader should see it, across the four orders of magnitude these
 * surfaces actually span.
 * @param {number|null} value From usdValue.
 * @returns {string|null} Null when there is nothing to print.
 */
export function formatUsd(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  if (value === 0) return USD_FORMAT.format(0)
  if (Math.abs(value) < 0.01) return USD_SMALL_FORMAT.format(value)
  if (Math.abs(value) >= 100000) return USD_LARGE_FORMAT.format(value)
  return USD_FORMAT.format(value)
}

/**
 * The two steps together, for the many callers that only want the string.
 * @param {string|number|bigint|null} amount Amount in base units.
 * @param {number|null|undefined} decimals The token's decimals.
 * @param {number|null|undefined} rate Dollars per whole token.
 * @returns {string|null}
 */
export function formatUsdAmount(amount, decimals, rate) {
  return formatUsd(usdValue(amount, decimals, rate))
}

/**
 * The rate for one row's payment token, out of a route's `usd` map.
 * Native-coin rows arrive with a null payment token and are keyed by the zero address, the same
 * normalization the routes apply when they build the map.
 * @param {Object|null} usd Map from the route, keyed by lowercased token address.
 * @param {string|null|undefined} paymentToken The row's payment token.
 * @returns {number|null}
 */
export function rateFor(usd, paymentToken) {
  if (!usd) return null
  const key = (paymentToken || '0x0000000000000000000000000000000000000000').toLowerCase()
  return usd[key] ?? null
}

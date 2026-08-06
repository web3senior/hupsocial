// HupTrade's platform fee, referral share, and seller proceeds all price in basis points
// against this denominator — kept in sync with FEE_DENOMINATOR in HupTrade.sol
export const FEE_DENOMINATOR = 10_000

const percentFormat = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 2 })

/**
 * Renders a basis-point rate as a percentage ("1%", "0.25%").
 * @param {number|bigint} bps
 * @returns {string}
 */
export const formatBps = (bps) => percentFormat.format((Number(bps) || 0) / FEE_DENOMINATOR)

/**
 * Splits a sale price the way HupTrade takes it apart at buy time: the platform fee comes
 * off first, the seller-set referral share next, and the seller keeps the remainder. Works
 * in display numbers, not token units — quoting a settlement, never computing a transfer.
 * @param {number} price
 * @param {number} [feeBps] Platform fee rate.
 * @param {number} [referralBps] Seller-set referral rate.
 * @returns {{fee: number, referral: number, seller: number}}
 */
export const splitSalePrice = (price, feeBps, referralBps) => {
  const fee = (price * (Number(feeBps) || 0)) / FEE_DENOMINATOR
  const referral = (price * (Number(referralBps) || 0)) / FEE_DENOMINATOR

  return { fee, referral, seller: price - fee - referral }
}

/**
 * Recovers the rate a recorded fee was charged at — indexed sale rows store amounts, not
 * rates, so "0.015 ETH" only reads as a fee once it's shown against the price it came from.
 * @param {string|bigint} feeAmount Fee in token units.
 * @param {string|bigint} price Sale price in token units.
 * @returns {string|null} Formatted percentage, or null when it rounds away to nothing.
 */
export const formatFeeShare = (feeAmount, price) => {
  try {
    const priceUnits = BigInt(price || '0')
    if (priceUnits === 0n) return null

    const bps = Number((BigInt(feeAmount || '0') * BigInt(FEE_DENOMINATOR)) / priceUnits)
    return bps > 0 ? formatBps(bps) : null
  } catch {
    return null
  }
}

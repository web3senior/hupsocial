/**
 * @file lib/cashtagFormat.js
 * @description How a cashtag's numbers are written, shared by both surfaces that write them.
 *
 * The hover card and the card under a post quote the same token, so agreeing on the source is
 * not enough — they have to agree on the rendering too. A price rounded to eight places in one
 * and ten in the other reads as two different prices, and a 24h move printed beside a
 * week-long one reads as a contradiction rather than as two windows.
 *
 * Both surfaces therefore take their price, their percentage, and the window that percentage
 * describes from here.
 */

import { rangeLabelFor } from './priceHistory'

// Sub-cent memecoins need the long tail or $BONK renders as "$0.00"
export const priceLabel = (price) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: price < 0.01 ? 8 : price < 1 ? 6 : 2,
  }).format(price)

// A launch-price move can run to six figures of percent — ANSEM's is +125,000% — so anything
// past four digits switches to compact notation rather than breaking the row
export const percentLabel = (percent) => {
  const magnitude = Math.abs(percent)
  const formatted =
    magnitude >= 10_000
      ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(magnitude)
      : magnitude.toFixed(2)
  return `${formatted}%`
}

// A card carries direction in its arrow, so percentLabel drops the sign. A hover string has no
// arrow beside it, so it has to say which way the period went.
export const signedPercentLabel = (percent) => `${percent >= 0 ? '+' : '−'}${percentLabel(percent)}`

/**
 * The one move a cashtag prints, and what to call the window it covers.
 *
 * The series' own change wins whenever there is a series: printing a 24h figure beside a
 * week-long chart meant ANSEM could show a red number over a green line — down on the day, up
 * on the week — and neither reading was wrong, which is what made it impossible to trust. The
 * label always names whichever number won, so the two can never drift apart.
 *
 * @param {{change24h: ?number, history: ?object}} token a row from /api/v1/tokens/cashtags
 * @returns {{change: ?number, label: string}}
 */
export const changeFor = (token) => {
  const history = token?.history
  const period = history?.changePct
  const hasPeriod = typeof period === 'number' && Number.isFinite(period)
  const change = hasPeriod ? period : token?.change24h

  return {
    change: typeof change === 'number' && Number.isFinite(change) ? change : null,
    // Named by what the line actually spans, not by what was requested — see rangeLabelFor
    label: hasPeriod ? rangeLabelFor(history) : '24h',
  }
}

/**
 * @file lib/nftFloorDelta.js
 * @description How far a price sits from a collection's floor, and the rules for saying so.
 *
 * Two surfaces ask this question of the same floor: the collection table, of every ask on the
 * page, and one token's offer book, of every bid on that token. They have to answer it the same
 * way — a bid the offer table calls "at floor" and the collection table calls "-0.3%" is one
 * number disagreeing with itself, and a reader comparing the two pages has no way to tell which
 * to believe.
 *
 * The comparison is only meaningful when both sides are quoted in the same currency. A floor in
 * LYX against a bid in USDC produces a percentage that looks authoritative and means nothing,
 * so `comparableToFloor` gates it rather than letting the arithmetic run regardless.
 */

// signDisplay carries the direction, so a cell never needs the words "above"/"below"
export const PERCENT_FORMAT = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
})

// Inside this band a price is the floor for every purpose a reader has — printing "+0.2%"
// would be precision nobody asked for
export const AT_FLOOR_BAND = 0.005

/**
 * How far a price sits from the floor, as a fraction.
 * Base units throughout, so this holds for any price a chain can express — Number only enters
 * after the ratio has been taken in BigInt.
 * @param {string|number|bigint} price Price, in base units.
 * @param {string|number|bigint} floor Collection floor, in base units.
 * @returns {number|null} Fraction above (positive) or below (negative) the floor.
 */
export function floorDelta(price, floor) {
  try {
    const ask = BigInt(price)
    const base = BigInt(floor)
    if (base === 0n) return null

    // Four decimals of ratio, taken before the divide, so small deltas survive
    return Number(((ask - base) * 10000n) / base) / 10000
  } catch {
    return null
  }
}

/**
 * Whether a price can be measured against this floor at all — both sides present, and quoted in
 * the same currency. A missing symbol on either side is treated as a match: the native coin
 * arrives from store_tokens with no symbol, and both sides fill it in from the same chain config.
 * @param {Object} params
 * @param {string|number|null} params.price Price, in base units.
 * @param {string|null} params.symbol Currency the price is quoted in.
 * @param {Object|null} params.floor From useCollectionFloor — {floor, symbol, decimals}.
 * @returns {boolean}
 */
export function comparableToFloor({ price, symbol, floor }) {
  return Boolean(price && floor?.floor && (!floor.symbol || !symbol || floor.symbol === symbol))
}

/**
 * The whole comparison in one call, for a cell that just wants to know what to print.
 * @param {Object} params Same shape as comparableToFloor.
 * @returns {{delta: number|null, atFloor: boolean}} `delta` null when the two can't be compared.
 */
export function readFloorDelta({ price, symbol, floor }) {
  const delta = comparableToFloor({ price, symbol, floor }) ? floorDelta(price, floor.floor) : null
  return { delta, atFloor: delta !== null && Math.abs(delta) < AT_FLOOR_BAND }
}

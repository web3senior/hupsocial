/**
 * @file lib/launchStats.js
 * @description Rollups over launch_trades — all-time high, distinct traders, 24h volume, the
 * change windows and the sparkline series.
 *
 * Everything here is derived rather than stored, because the launches row carries lifetime totals
 * only: a 24h figure or a change window read off it would be the token's whole history wearing a
 * day's label. Shared by the launches list and the multichain explorer, which need the same
 * numbers from the same table and must not disagree about what "24h volume" means.
 */

import pool from '@/lib/db'

const HOUR = 3600
const DAY = 86400
// Twelve two-hour closes. Enough shape for a sparkline, few enough to stay one grouped query.
const SPARK_BUCKET = 7200

/**
 * The price of the last trade before a cutoff, as one aggregate.
 *
 * MariaDB has no "value at the max of another column" aggregate, so the timestamp is zero-padded
 * into a sortable prefix, MAX picks the latest row, and the price is cut back off the end.
 */
const priceBefore = (alias) =>
  `SUBSTRING_INDEX(MAX(CASE WHEN traded_at < ? THEN CONCAT(LPAD(traded_at, 20, '0'), ':', price) END), ':', -1) AS ${alias}`

/** Placeholders and arguments for a `(network_id, launch_id) IN (...)` row-constructor list. */
const pairFilter = (rows) => ({
  placeholders: rows.map(() => '(?,?)').join(','),
  args: rows.flatMap((row) => [row.network_id, row.launch_id]),
})

/**
 * Attaches the launch_trades rollups to a page of launches. Mutates the rows in place; a launch
 * with no trades keeps its zeroes and falls back to its opening price.
 *
 * @param {Array<{network_id: number, launch_id: number|string, price: string, opening_price: string}>} rows
 * @param {number} now Unix seconds the windows are measured back from.
 */
export async function attachLaunchTradeStats(rows, now) {
  if (!Array.isArray(rows) || rows.length === 0) return rows

  const { placeholders, args } = pairFilter(rows)
  const cutoff1h = now - HOUR
  const cutoff6h = now - 6 * HOUR
  const cutoff24h = now - DAY

  const [stats] = await pool.execute(
    `SELECT
       network_id,
       launch_id,
       CAST(MAX(price) AS CHAR) AS ath_price,
       COUNT(DISTINCT trader) AS trader_count,
       CAST(COALESCE(SUM(CASE WHEN traded_at >= ? THEN native_amount END), 0) AS CHAR) AS volume_24h,
       COALESCE(SUM(CASE WHEN traded_at >= ? THEN 1 END), 0) AS txns_24h,
       MAX(traded_at) AS last_trade_at,
       ${priceBefore('price_1h_ago')},
       ${priceBefore('price_6h_ago')},
       ${priceBefore('price_24h_ago')}
     FROM launch_trades
     WHERE (network_id, launch_id) IN (${placeholders})
     GROUP BY network_id, launch_id`,
    [cutoff24h, cutoff24h, cutoff1h, cutoff6h, cutoff24h, ...args],
  )

  // Two-hour closes over the last day, in order, so the client draws a series rather than
  // re-deriving one from a page of raw trades
  const [series] = await pool.execute(
    `SELECT
       network_id,
       launch_id,
       SUBSTRING_INDEX(MAX(CONCAT(LPAD(traded_at, 20, '0'), ':', price)), ':', -1) AS close
     FROM launch_trades
     WHERE traded_at >= ? AND (network_id, launch_id) IN (${placeholders})
     GROUP BY network_id, launch_id, FLOOR(traded_at / ${SPARK_BUCKET})
     ORDER BY network_id, launch_id, FLOOR(traded_at / ${SPARK_BUCKET})`,
    [cutoff24h, ...args],
  )

  const statsByLaunch = new Map(stats.map((row) => [`${row.network_id}:${row.launch_id}`, row]))
  const seriesByLaunch = new Map()
  for (const point of series) {
    const key = `${point.network_id}:${point.launch_id}`
    if (!seriesByLaunch.has(key)) seriesByLaunch.set(key, [])
    seriesByLaunch.get(key).push(point.close)
  }

  for (const row of rows) {
    const key = `${row.network_id}:${row.launch_id}`
    const stat = statsByLaunch.get(key)

    row.ath_price = stat?.ath_price ?? row.price
    row.trader_count = Number(stat?.trader_count ?? 0)
    row.volume_24h = stat?.volume_24h ?? '0'
    row.txns_24h = Number(stat?.txns_24h ?? 0)
    row.last_trade_at = stat?.last_trade_at ? Number(stat.last_trade_at) : (row.last_trade_at ?? null)

    // A launch younger than the window has no trade before it, and its opening price is exactly
    // the right baseline — that is what "since it existed" means for a token an hour old
    row.price_1h_ago = stat?.price_1h_ago ?? row.opening_price
    row.price_6h_ago = stat?.price_6h_ago ?? row.opening_price
    row.price_24h_ago = stat?.price_24h_ago ?? row.opening_price
    row.spark = seriesByLaunch.get(key) ?? []
  }

  return rows
}

export default attachLaunchTradeStats

/**
 * @file lib/salesTotals.js
 * @description Attaches a per-post USD sales total to post rows so a gated-content listing can
 * show what it earned instead of only how many copies went. Mirrors lib/tipTotals.js exactly:
 * sales land in the DB as raw base units per token (cidex's runSellSync), so the dollars are
 * resolved at read time from the same best-effort DefiLlama helper the revenue route uses —
 * cosmetic display, never accounting. Rows with no priceable token (testnets, unlisted tokens)
 * get null and the UI falls back to the sale count.
 *
 * Reads store_sales, which cidex writes only on AccessGranted — so this is money the seller has
 * actually been paid, never an escrow still waiting on a key.
 */
import pool from '@/lib/db'
import { fetchUsdPrices, priceKeyFor } from '@/lib/prices'

/**
 * Sets `sales_usd` (number|null) and `sales_count` (number) on every row that has sales.
 * Mutates in place and returns the same array, matching the attachTipUsdTotals convention.
 * @param {Array<Object>} rows Post rows carrying id and network_id.
 * @returns {Promise<Array<Object>>} The same rows.
 */
export async function attachSalesUsdTotals(rows) {
  const candidates = (rows || []).filter((row) => row && row.id != null && row.network_id != null)
  if (candidates.length === 0) return rows

  const pairs = [...new Map(candidates.map((row) => [`${row.network_id}:${row.id}`, [row.network_id, row.id]])).values()]
  const params = []
  pairs.forEach(([networkId, postId]) => params.push(networkId, postId))

  // Gross per token, pre-fee: the badge reports what the listing earned, the same convention
  // the tip badge uses. Grouped per token because a listing may have changed payment token
  // mid-life, and summing base units across two tokens would be meaningless.
  const [sums] = await pool.execute(
    `SELECT s.network_id, s.post_id, s.payment_token AS token,
            CAST(SUM(s.amount) AS CHAR) AS total, COUNT(*) AS sales,
            st.decimals
     FROM store_sales s
     LEFT JOIN store_tokens st ON st.network_id = s.network_id AND st.token = s.payment_token
     WHERE (s.network_id, s.post_id) IN (${pairs.map(() => '(?, ?)').join(', ')})
     GROUP BY s.network_id, s.post_id, s.payment_token, st.decimals`,
    params,
  )

  if (sums.length === 0) return rows

  const prices = await fetchUsdPrices(sums.map((row) => priceKeyFor(Number(row.network_id), row.token)))

  const totals = new Map()
  const counts = new Map()
  for (const row of sums) {
    const key = `${row.network_id}:${row.post_id}`
    counts.set(key, (counts.get(key) || 0) + Number(row.sales))

    const price = prices.get(priceKeyFor(Number(row.network_id), row.token))
    if (price === undefined) continue
    const usd = (Number(row.total) / 10 ** (row.decimals ?? 18)) * price
    totals.set(key, (totals.get(key) || 0) + usd)
  }

  for (const row of candidates) {
    const key = `${row.network_id}:${row.id}`
    if (!counts.has(key)) continue
    row.sales_usd = totals.get(key) ?? null
    row.sales_count = counts.get(key)
  }

  return rows
}

export default attachSalesUsdTotals

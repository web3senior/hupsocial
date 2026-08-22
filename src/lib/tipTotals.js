/**
 * @file lib/tipTotals.js
 * @description Attaches a per-post USD tip total to post rows so the card's tip badge can
 * show money instead of a bare count. Tips land in the DB as raw base units per token
 * (cidex's runTipperSync), so the dollars are resolved at read time from the same
 * best-effort DefiLlama helper the revenue route uses — cosmetic display, never accounting.
 * Rows with no priceable token (testnets, unlisted tokens) get null and the UI falls back
 * to the count.
 */
import pool from '@/lib/db'
import { fetchUsdPrices, priceKeyFor } from '@/lib/prices'

/**
 * Sets `tips_usd` (number|null) on every row that has tips. Mutates in place and returns
 * the same array, matching the fulfillUniversalProfiles convention.
 * @param {Array<Object>} rows Post rows carrying id, network_id and total_tips.
 * @returns {Promise<Array<Object>>} The same rows.
 */
export async function attachTipUsdTotals(rows) {
  // total_tips is already on the row, so a page with no tipped posts costs zero queries
  const targets = (rows || []).filter((row) => row && Number(row.total_tips) > 0)
  if (targets.length === 0) return rows

  const pairs = [...new Map(targets.map((row) => [`${row.network_id}:${row.id}`, [row.network_id, row.id]])).values()]
  const params = []
  pairs.forEach(([networkId, postId]) => params.push(networkId, postId))

  // Gross amounts (pre-fee), matching what total_tips counts: the badge reports what the
  // post was tipped, not what the creator netted. Tuple order follows idx_post's leading
  // columns so the row-constructor IN stays on the index.
  const [sums] = await pool.execute(
    `SELECT t.network_id, t.post_id, t.token, CAST(SUM(t.amount) AS CHAR) AS total, st.decimals
     FROM tips t
     LEFT JOIN store_tokens st ON st.network_id = t.network_id AND st.token = t.token
     WHERE (t.network_id, t.post_id) IN (${pairs.map(() => '(?, ?)').join(', ')})
     GROUP BY t.network_id, t.post_id, t.token, st.decimals`,
    params,
  )

  const prices = await fetchUsdPrices(sums.map((row) => priceKeyFor(Number(row.network_id), row.token)))

  const totals = new Map()
  for (const row of sums) {
    const price = prices.get(priceKeyFor(Number(row.network_id), row.token))
    if (price === undefined) continue
    const usd = (Number(row.total) / 10 ** (row.decimals ?? 18)) * price
    const key = `${row.network_id}:${row.post_id}`
    totals.set(key, (totals.get(key) || 0) + usd)
  }

  for (const row of targets) {
    row.tips_usd = totals.get(`${row.network_id}:${row.id}`) ?? null
  }

  return rows
}

export default attachTipUsdTotals

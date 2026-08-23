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
 * Sets `tips_usd` (number|null) and `last_tip` ({usd, amount, symbol}|null) on every row
 * that has tips. Mutates in place and returns the same array, matching the
 * fulfillUniversalProfiles convention. `last_tip` feeds the card's soul animation — the
 * most recent tip floating out of the badge — so it keeps the token amount and symbol as
 * a fallback for chains where no USD price resolves.
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

  // The last tip per post, for the badge's soul animation. MAX(id) stands in for "most
  // recent": cidex inserts in scan order, which follows block order per chain — cosmetic
  // display, so a re-scan edge case landing out of order is acceptable. Its token is by
  // definition one of the summed tokens above, so the price map already covers it.
  const [[lastRows], prices] = await Promise.all([
    pool.execute(
      `SELECT t.network_id, t.post_id, t.token, CAST(t.amount AS CHAR) AS amount, st.symbol, st.decimals
       FROM tips t
       JOIN (
         SELECT MAX(id) AS id
         FROM tips
         WHERE (network_id, post_id) IN (${pairs.map(() => '(?, ?)').join(', ')})
         GROUP BY network_id, post_id
       ) last ON last.id = t.id
       LEFT JOIN store_tokens st ON st.network_id = t.network_id AND st.token = t.token`,
      params,
    ),
    fetchUsdPrices(sums.map((row) => priceKeyFor(Number(row.network_id), row.token))),
  ])

  const lastTips = new Map()
  for (const row of lastRows) {
    const price = prices.get(priceKeyFor(Number(row.network_id), row.token))
    const amount = Number(row.amount) / 10 ** (row.decimals ?? 18)
    lastTips.set(`${row.network_id}:${row.post_id}`, {
      usd: price === undefined ? null : amount * price,
      amount,
      symbol: row.symbol || null,
    })
  }

  const totals = new Map()
  for (const row of sums) {
    const price = prices.get(priceKeyFor(Number(row.network_id), row.token))
    if (price === undefined) continue
    const usd = (Number(row.total) / 10 ** (row.decimals ?? 18)) * price
    const key = `${row.network_id}:${row.post_id}`
    totals.set(key, (totals.get(key) || 0) + usd)
  }

  for (const row of targets) {
    const key = `${row.network_id}:${row.id}`
    row.tips_usd = totals.get(key) ?? null
    row.last_tip = lastTips.get(key) ?? null
  }

  return rows
}

export default attachTipUsdTotals

/**
 * @file api/v1/users/[address]/revenue/route.js
 * @description A seller's HupBazzar sales history: per-token totals plus paginated per-sale
 * rows joined with post content. Backed by the store_sales table, which the cidex indexer
 * populates continuously from ItemBought events — this route only reads.
 * Amounts travel as raw-unit strings (BigInt-safe); sold_at is unix seconds.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

export async function GET(request, { params }) {
  try {
    const { address } = await params
    const { searchParams } = new URL(request.url)

    if (!address || !/^0x[a-f0-9]{40}$/i.test(address)) {
      return NextResponse.json({ success: false, error: 'Invalid profile address' }, { status: 400 })
    }

    const wallet = address.toLowerCase()
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || DEFAULT_LIMIT, 1), MAX_LIMIT)
    const before = Number(searchParams.get('before')) || null

    const [totalsResult, overviewResult, rowsResult] = await Promise.all([
      pool.execute(
        `SELECT s.network_id, s.payment_token AS token, t.symbol, t.decimals,
                CAST(SUM(s.amount) AS CHAR) AS total, COUNT(*) AS sales, SUM(s.quantity) AS units
         FROM store_sales s
         LEFT JOIN store_tokens t ON t.network_id = s.network_id AND t.token = s.payment_token
         WHERE s.seller = ?
         GROUP BY s.network_id, s.payment_token, t.symbol, t.decimals
         ORDER BY SUM(s.amount) DESC`,
        [wallet],
      ),
      pool.execute(
        `SELECT COUNT(DISTINCT s.buyer) AS buyer_count, COUNT(*) AS sales_count, COALESCE(SUM(s.quantity), 0) AS units_sold
         FROM store_sales s
         WHERE s.seller = ?`,
        [wallet],
      ),
      pool.execute(
        // Keyset pagination on id (insert order tracks chain order) — offset pages would drift
        // when the indexer inserts new rows between fetches. limit + 1 detects the next page.
        `SELECT s.id, s.network_id, n.name AS network_name, s.post_id, p.content, s.buyer,
                s.quantity, s.payment_token AS token, t.symbol, t.decimals,
                CAST(s.amount AS CHAR) AS amount, s.tx_hash, s.sold_at
         FROM store_sales s
         LEFT JOIN posts p ON p.id = s.post_id AND p.network_id = s.network_id
         LEFT JOIN networks n ON n.id = s.network_id
         LEFT JOIN store_tokens t ON t.network_id = s.network_id AND t.token = s.payment_token
         WHERE s.seller = ?${before ? ' AND s.id < ?' : ''}
         ORDER BY s.id DESC
         LIMIT ${limit + 1}`,
        before ? [wallet, before] : [wallet],
      ),
    ])

    const [totals] = totalsResult
    const [[overview]] = overviewResult
    const [rows] = rowsResult

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    return NextResponse.json({
      success: true,
      data: {
        totals: totals.map((row) => ({
          network_id: row.network_id,
          token: row.token,
          symbol: row.symbol || 'tokens',
          decimals: row.decimals ?? 18,
          total: row.total,
          sales: Number(row.sales),
          units: Number(row.units),
        })),
        buyer_count: Number(overview.buyer_count),
        units_sold: Number(overview.units_sold),
        sales_count: Number(overview.sales_count),
        sales: page.map((row) => ({
          id: row.id,
          network_id: row.network_id,
          network_name: row.network_name,
          post_id: row.post_id,
          content: parseIPFSContent(row.content),
          buyer: row.buyer,
          quantity: Number(row.quantity),
          token: row.token,
          symbol: row.symbol || 'tokens',
          decimals: row.decimals ?? 18,
          amount: row.amount,
          tx_hash: row.tx_hash,
          sold_at: Number(row.sold_at),
        })),
        next_cursor: hasMore ? page[page.length - 1].id : null,
      },
    })
  } catch (error) {
    console.error('[REVENUE_FETCH_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

function parseIPFSContent(content) {
  try {
    return JSON.parse(content)
  } catch (e) {
    return content
  }
}

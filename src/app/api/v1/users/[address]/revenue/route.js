/**
 * @file api/v1/users/[address]/revenue/route.js
 * @description A creator's revenue across all three onchain income sources: HupBazaar sales
 * (store_sales), NFT-in-post trades (nft_trades), and post tips (tips). Totals combine every
 * source per token, net of protocol fees and referral cuts; ?source= picks which paginated
 * row stream to return. All tables are populated by cidex indexers — this route only reads.
 * Amounts travel as raw-unit strings (BigInt-safe); timestamps are unix seconds.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fetchUsdPrices, priceKeyFor } from '@/lib/prices'

export const runtime = 'nodejs'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const SOURCES = ['bazaar', 'nfts', 'tips']

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
    const sourceParam = searchParams.get('source')
    const source = SOURCES.includes(sourceParam) ? sourceParam : 'bazaar'
    // Wallet-style network filter — scopes totals, counts, and rows alike.
    const network = Number(searchParams.get('network')) || null
    const net = network ? ' AND network_id = ?' : ''
    const netArg = network ? [network] : []

    const [totalsResult, countsResult, rowsResult] = await Promise.all([
      pool.execute(
        // Net-of-fees union across the three revenue tables, then one per-token rollup.
        `SELECT x.network_id, n.name AS network_name, x.token, t.symbol, t.decimals,
                CAST(SUM(x.net) AS CHAR) AS total, COUNT(*) AS payments, MAX(x.is_lsp7) AS is_lsp7
         FROM (
           SELECT network_id, payment_token AS token, is_lsp7, amount - fee_amount AS net
           FROM store_sales WHERE seller = ?${net}
           UNION ALL
           SELECT network_id, payment_token, is_lsp7, price - fee_amount - referral_amount
           FROM nft_trades WHERE seller = ?${net}
           UNION ALL
           SELECT network_id, token, is_lsp7, amount - fee_amount
           FROM tips WHERE creator = ?${net}
         ) x
         LEFT JOIN networks n ON n.id = x.network_id
         LEFT JOIN store_tokens t ON t.network_id = x.network_id AND t.token = x.token
         GROUP BY x.network_id, n.name, x.token, t.symbol, t.decimals
         ORDER BY SUM(x.net) DESC`,
        [wallet, ...netArg, wallet, ...netArg, wallet, ...netArg],
      ),
      pool.execute(
        `SELECT
           (SELECT COUNT(*) FROM store_sales WHERE seller = ?${net}) AS bazaar_count,
           (SELECT COUNT(*) FROM nft_trades WHERE seller = ?${net}) AS nft_count,
           (SELECT COUNT(*) FROM tips WHERE creator = ?${net}) AS tip_count,
           (SELECT COUNT(*) FROM (
              SELECT buyer AS payer FROM store_sales WHERE seller = ?${net}
              UNION
              SELECT buyer FROM nft_trades WHERE seller = ?${net}
              UNION
              SELECT tipper FROM tips WHERE creator = ?${net}
            ) u) AS supporter_count`,
        [wallet, ...netArg, wallet, ...netArg, wallet, ...netArg, wallet, ...netArg, wallet, ...netArg, wallet, ...netArg],
      ),
      fetchRows(source, wallet, before, limit, network),
    ])

    const [totals] = totalsResult
    const [[counts]] = countsResult
    const [rows] = rowsResult

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    const prices = await fetchUsdPrices(totals.map((row) => priceKeyFor(row.network_id, row.token)))

    return NextResponse.json({
      success: true,
      data: {
        totals: totals.map((row) => {
          const decimals = row.decimals ?? 18
          const price = prices.get(priceKeyFor(row.network_id, row.token))
          return {
            network_id: row.network_id,
            network_name: row.network_name,
            token: row.token,
            symbol: row.symbol || 'tokens',
            decimals,
            total: row.total,
            payments: Number(row.payments),
            is_lsp7: Boolean(Number(row.is_lsp7)),
            // Cosmetic only — display precision, not accounting precision.
            usd_value: price !== undefined ? (Number(row.total) / 10 ** decimals) * price : null,
          }
        }),
        counts: {
          bazaar: Number(counts.bazaar_count),
          nfts: Number(counts.nft_count),
          tips: Number(counts.tip_count),
        },
        supporter_count: Number(counts.supporter_count),
        source,
        rows: page.map((row) => normalizeRow(source, row)),
        next_cursor: hasMore ? page[page.length - 1].id : null,
      },
    })
  } catch (error) {
    console.error('[REVENUE_FETCH_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

// Keyset pagination on id for every source (insert order tracks chain order) — offset pages
// would drift when the indexer inserts new rows between fetches. limit + 1 detects the next page.
function fetchRows(source, wallet, before, limit, network) {
  const tail = `${network ? ' AND s.network_id = ?' : ''}${before ? ' AND s.id < ?' : ''}
       ORDER BY s.id DESC
       LIMIT ${limit + 1}`
  const args = [wallet, ...(network ? [network] : []), ...(before ? [before] : [])]

  if (source === 'tips') {
    return pool.execute(
      `SELECT s.id, s.network_id, n.name AS network_name, s.post_id, p.content, s.tipper AS payer,
              s.token, t.symbol, t.decimals, CAST(s.amount - s.fee_amount AS CHAR) AS amount,
              s.tx_hash, s.tipped_at AS at
       FROM tips s
       LEFT JOIN posts p ON p.id = s.post_id AND p.network_id = s.network_id
       LEFT JOIN networks n ON n.id = s.network_id
       LEFT JOIN store_tokens t ON t.network_id = s.network_id AND t.token = s.token
       WHERE s.creator = ?${tail}`,
      args,
    )
  }

  if (source === 'nfts') {
    return pool.execute(
      `SELECT s.id, s.network_id, n.name AS network_name, s.collection, s.token_id, s.buyer AS payer,
              s.payment_token AS token, t.symbol, t.decimals,
              CAST(s.price - s.fee_amount - s.referral_amount AS CHAR) AS amount,
              s.tx_hash, s.sold_at AS at
       FROM nft_trades s
       LEFT JOIN networks n ON n.id = s.network_id
       LEFT JOIN store_tokens t ON t.network_id = s.network_id AND t.token = s.payment_token
       WHERE s.seller = ?${tail}`,
      args,
    )
  }

  return pool.execute(
    `SELECT s.id, s.network_id, n.name AS network_name, s.post_id, p.content, s.buyer AS payer,
            s.quantity, s.payment_token AS token, t.symbol, t.decimals,
            CAST(s.amount - s.fee_amount AS CHAR) AS amount, s.tx_hash, s.sold_at AS at
     FROM store_sales s
     LEFT JOIN posts p ON p.id = s.post_id AND p.network_id = s.network_id
     LEFT JOIN networks n ON n.id = s.network_id
     LEFT JOIN store_tokens t ON t.network_id = s.network_id AND t.token = s.payment_token
     WHERE s.seller = ?${tail}`,
    args,
  )
}

function normalizeRow(source, row) {
  const base = {
    id: row.id,
    kind: source === 'nfts' ? 'nft' : source === 'tips' ? 'tip' : 'sale',
    network_id: row.network_id,
    network_name: row.network_name,
    payer: row.payer,
    token: row.token,
    symbol: row.symbol || 'tokens',
    decimals: row.decimals ?? 18,
    amount: row.amount,
    tx_hash: row.tx_hash,
    at: Number(row.at),
  }

  if (source === 'nfts') {
    return { ...base, collection: row.collection, token_id: row.token_id }
  }
  if (source === 'tips') {
    return { ...base, post_id: row.post_id, content: parseIPFSContent(row.content) }
  }
  return { ...base, post_id: row.post_id, content: parseIPFSContent(row.content), quantity: Number(row.quantity) }
}

function parseIPFSContent(content) {
  try {
    return JSON.parse(content)
  } catch (e) {
    return content
  }
}

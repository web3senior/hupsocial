/**
 * @file api/v1/nfts/tokens/route.js
 * @description The payment tokens sellers have actually priced HupTrade listings in, for the
 * NFT Market's "Payment token" filter. Derived from the cidex-indexed nft_listings table rather
 * than a curated config, so a listing priced in any token is still findable.
 *
 * Symbol and decimals come from store_tokens (the same join the listings route uses); tokens the
 * indexer hasn't named yet come back with a null symbol and are labelled by address client-side.
 * Sold listings still count — that token is a currency the market's sold view can be filtered
 * by — but cancelled ones don't, so the filter can't offer a currency with nothing behind it.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

const NATIVE = '0x0000000000000000000000000000000000000000'

// Active + sold — the same rows GET /api/v1/nfts will serve; cancelled is off the market
const MARKET_STATUSES = [1, 2]

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const networkId = searchParams.get('networkId')

    let whereClause = ` WHERE l.status IN (${MARKET_STATUSES.map(() => '?').join(',')})`
    const whereParams = [...MARKET_STATUSES]

    if (networkId) {
      whereClause += ` AND l.network_id = ?`
      whereParams.push(networkId)
    }

    const [rows] = await pool.execute(
      `SELECT l.network_id, l.payment_token, MAX(l.is_lsp7) AS is_lsp7,
              COUNT(*) AS listing_count, st.symbol, st.decimals
         FROM nft_listings l
         LEFT JOIN store_tokens st ON st.network_id = l.network_id AND st.token = l.payment_token
         ${whereClause}
        GROUP BY l.network_id, l.payment_token, st.symbol, st.decimals
        ORDER BY listing_count DESC`,
      whereParams,
    )

    // A chain's native currency reaches the contract as either NULL or the zero address, so its
    // rows merge into one entry per chain — the filter treats both the same way.
    const merged = new Map()
    for (const row of rows) {
      const isNative = !row.payment_token || row.payment_token === NATIVE
      const token = isNative ? NATIVE : String(row.payment_token).toLowerCase()
      const key = `${row.network_id}-${token}`
      const existing = merged.get(key)

      if (existing) {
        existing.listing_count += Number(row.listing_count) || 0
        existing.symbol = existing.symbol || row.symbol || null
        existing.decimals = existing.decimals ?? row.decimals ?? null
        continue
      }

      merged.set(key, {
        network_id: row.network_id,
        token,
        is_native: isNative,
        is_lsp7: Number(row.is_lsp7) === 1,
        symbol: row.symbol || null,
        decimals: row.decimals ?? null,
        listing_count: Number(row.listing_count) || 0,
      })
    }

    const data = [...merged.values()].sort((a, b) => b.listing_count - a.listing_count)

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('[GET_NFT_PAYMENT_TOKENS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

/**
 * @file api/v1/trade/listings/route.js
 * @description Lists a seller's active HupTrade NFT listings from the cidex-indexed
 * nft_listings table, with payment-token metadata for price formatting. Lets the composer
 * surface listings that exist onchain but were never attached to a post (listed, then the
 * post was abandoned) so they can be re-attached or cancelled. The app never scans chains —
 * HupTrade's events land here via the cidex runTradeSync runner.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

const STATUS_ACTIVE = 1

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)

    const networkId = parseInt(searchParams.get('networkId'))
    const seller = (searchParams.get('seller') || '').toLowerCase()

    if (!Number.isFinite(networkId) || !/^0x[0-9a-f]{40}$/.test(seller)) {
      return NextResponse.json({ success: false, error: 'networkId and seller are required' }, { status: 400 })
    }

    // Prices stay in base units (decimal strings) — the client formats them with the
    // token's decimals/symbol from store_tokens (cached there by the indexer, so no
    // chain reads happen here). Native listings join on the zero address row.
    const [rows] = await pool.execute(
      `SELECT
        l.listing_id,
        l.collection,
        l.token_id,
        l.is_lsp8,
        l.payment_token,
        l.is_lsp7,
        l.price,
        l.referral_bps,
        l.listed_at,
        st.symbol,
        st.decimals
      FROM nft_listings l
      LEFT JOIN store_tokens st ON st.network_id = l.network_id AND st.token = l.payment_token
      WHERE l.network_id = ? AND l.seller = ? AND l.status = ?
      ORDER BY l.listing_id DESC
      LIMIT 50`,
      [networkId, seller, STATUS_ACTIVE],
    )

    return NextResponse.json({ success: true, data: rows })
  } catch (error) {
    console.error('[GET_TRADE_LISTINGS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

/**
 * @file api/v1/nfts/[id]/route.js
 * @description Fetches a single indexed HupTrade NFT listing by its onchain id + network,
 * mirroring the predict detail pattern. Returns the nft_listings replay row (listing terms and
 * status as of the last indexed block), the immutable nft_trades sale records, and the id of
 * the post carrying the listing so the detail page can link back to the conversation. Cancelled
 * listings are still served — the page is the permanent record of a listing's lifecycle.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'

export const runtime = 'nodejs'

export async function GET(request, { params }) {
  try {
    const { id: listingId } = await params
    const { searchParams } = new URL(request.url)
    const networkId = parseInt(searchParams.get('networkId')) || null

    if (!networkId || !/^\d+$/.test(String(listingId))) {
      return NextResponse.json({ success: false, error: 'networkId and a numeric listing id are required' }, { status: 400 })
    }

    const [rows] = await pool.execute(
      `SELECT
         l.network_id, l.listing_id, l.seller AS wallet_address, l.collection, l.token_id,
         l.is_lsp8, l.payment_token, l.is_lsp7, CAST(l.price AS CHAR) AS price, l.referral_bps,
         l.status, l.listed_at, l.tx_hash, u.name AS display_name, u.profileImage AS profile_image
       FROM nft_listings l
       LEFT JOIN users u ON u.wallet_address = l.seller
       WHERE l.network_id = ? AND l.listing_id = ?
       LIMIT 1`,
      [networkId, listingId],
    )

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Listing not found' }, { status: 404 })
    }

    const listing = rows[0]
    await fulfillUniversalProfiles([listing], pool)

    // Immutable sale records — one row per Sold event, newest first. uint256 amounts are
    // decimal(65,0) in MySQL; CAST keeps them as strings for lossless BigInt handling.
    const [trades] = await pool.execute(
      `SELECT t.buyer AS wallet_address, t.referral, CAST(t.price AS CHAR) AS price,
              CAST(t.fee_amount AS CHAR) AS fee_amount, CAST(t.referral_amount AS CHAR) AS referral_amount,
              t.sold_at, t.tx_hash, u.name AS display_name, u.profileImage AS profile_image
       FROM nft_trades t
       LEFT JOIN users u ON u.wallet_address = t.buyer
       WHERE t.network_id = ? AND t.listing_id = ?
       ORDER BY t.block_number DESC, t.log_index DESC`,
      [networkId, listingId],
    )
    await fulfillUniversalProfiles(trades, pool)

    // The post carrying this listing, matched through the nft_listing_id generated column —
    // same link the NFT market feed joins on
    const [postRows] = await pool.execute(
      `SELECT id FROM posts
       WHERE network_id = ? AND nft_listing_id = ? AND is_comment IS NULL AND is_deleted = 0
       ORDER BY id ASC
       LIMIT 1`,
      [networkId, listingId],
    )

    return NextResponse.json({
      success: true,
      data: {
        listing,
        trades,
        postId: postRows[0]?.id ?? null,
      },
    })
  } catch (error) {
    console.error('[GET_NFT_LISTING_DETAIL_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

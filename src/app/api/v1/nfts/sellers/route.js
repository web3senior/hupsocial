/**
 * @file api/v1/nfts/sellers/route.js
 * @description Seller suggestions for the NFT Market's "Seller" typeahead — only wallets
 * that actually have HupTrade listings, matched by display name or wallet-address prefix.
 * Derived from the cidex-indexed nft_listings table (same source as the tokens filter), so
 * the list can never offer a user whose grid would come back empty. An empty query returns
 * the market's most active sellers, which fills the list the moment the field is focused.
 *
 * Scoped to the statuses the market shows: a seller whose listings all sold is still worth
 * filtering by (the grid's own status filter decides which of those show), but one whose
 * every listing was cancelled has nothing on the shelf and would only offer an empty grid.
 * Names come from the users table; unnamed LUKSO sellers are filled from their Universal
 * Profile like the listings route.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'

export const runtime = 'nodejs'

// Active + sold — the same rows GET /api/v1/nfts will serve; cancelled is off the market
const MARKET_STATUSES = [1, 2]

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const q = (searchParams.get('q') || '').trim()
    const networkId = searchParams.get('networkId')

    let whereClause = ` WHERE l.status IN (${MARKET_STATUSES.map(() => '?').join(',')})`
    const whereParams = [...MARKET_STATUSES]

    if (networkId) {
      whereClause += ` AND l.network_id = ?`
      whereParams.push(networkId)
    }

    if (q) {
      whereClause += ` AND (u.name LIKE ? OR l.seller LIKE ?)`
      // Wallets match as a prefix — pasting the start of an address narrows immediately,
      // while a bare substring over hex would match half the table
      whereParams.push(`%${q}%`, `${q.toLowerCase()}%`)
    }

    const [rows] = await pool.execute(
      `SELECT l.seller AS wallet_address, COUNT(*) AS listing_count,
              u.name AS display_name, u.profileImage AS profile_image
         FROM nft_listings l
         LEFT JOIN users u ON u.wallet_address = l.seller
         ${whereClause}
        GROUP BY l.seller, u.name, u.profileImage
        ORDER BY listing_count DESC
        LIMIT 8`,
      whereParams,
    )

    const data = rows.map((row) => ({ ...row, listing_count: Number(row.listing_count) || 0 }))
    await fulfillUniversalProfiles(data, pool)

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('[GET_NFT_SELLERS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

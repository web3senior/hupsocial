/**
 * @file api/v1/nfts/route.js
 * @description Lists HupTrade NFT listings straight from the cidex-indexed nft_listings
 * table for the NFT Market grid — status/network/standard/payment-token/price/seller and
 * sort all resolve here in SQL. Name/collection search stays client-side (TradeCard-style
 * metadata — image, name, traits — is fetched live per token, not indexed), so this route
 * has no `search` param; the client filters the resolved grid by name itself.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'

export const runtime = 'nodejs'

const STATUS_BY_KEY = { active: [1], sold: [2], cancelled: [3], all: [1, 2, 3] }

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)

    const page = parseInt(searchParams.get('page')) || 1
    const limit = Math.min(parseInt(searchParams.get('limit')) || 24, 60)
    const offset = (page - 1) * limit

    const networkId = searchParams.get('networkId')
    const collection = searchParams.get('collection') // contract address — name isn't indexed, resolved client-side
    const standard = searchParams.get('standard') // 'lsp8' | 'erc721'
    const token = searchParams.get('token') // 'native' | address
    const minPrice = searchParams.get('minPrice') // base units, decimal string
    const maxPrice = searchParams.get('maxPrice')
    const seller = searchParams.get('seller') // address or username fragment
    const referral = searchParams.get('referral') // 'any' (>0) | 'none' (=0) | minimum bps, e.g. '500' for 5%+
    const sort = searchParams.get('sort') || 'newest' // 'newest' | 'price_asc' | 'price_desc'
    const statusKey = searchParams.get('status') || 'default'
    // Default mirrors the old NFT-market feed: active + sold, cancelled hidden
    const statuses = statusKey === 'default' ? [1, 2] : STATUS_BY_KEY[statusKey] || [1, 2]

    let whereClause = ` WHERE l.status IN (${statuses.map(() => '?').join(',')})`
    const whereParams = [...statuses]

    if (networkId) {
      whereClause += ` AND l.network_id = ?`
      whereParams.push(networkId)
    }

    if (collection) {
      whereClause += ` AND l.collection = ?`
      whereParams.push(collection.toLowerCase())
    }

    if (standard === 'lsp8') {
      whereClause += ` AND l.is_lsp8 = 1`
    } else if (standard === 'erc721') {
      whereClause += ` AND l.is_lsp8 = 0`
    }

    if (token === 'native') {
      whereClause += ` AND (l.payment_token IS NULL OR l.payment_token = '0x0000000000000000000000000000000000000000')`
    } else if (token) {
      whereClause += ` AND l.payment_token = ?`
      whereParams.push(token.toLowerCase())
    }

    // Reposters shop by referral share, so the threshold is a first-class filter
    if (referral === 'none') {
      whereClause += ` AND l.referral_bps = 0`
    } else if (referral === 'any') {
      whereClause += ` AND l.referral_bps > 0`
    } else if (referral) {
      const minReferralBps = parseInt(referral, 10)
      if (Number.isFinite(minReferralBps) && minReferralBps > 0) {
        whereClause += ` AND l.referral_bps >= ?`
        whereParams.push(minReferralBps)
      }
    }

    if (minPrice) {
      whereClause += ` AND CAST(l.price AS DECIMAL(65,0)) >= ?`
      whereParams.push(minPrice)
    }
    if (maxPrice) {
      whereClause += ` AND CAST(l.price AS DECIMAL(65,0)) <= ?`
      whereParams.push(maxPrice)
    }

    if (seller) {
      if (/^0x[0-9a-fA-F]{40}$/.test(seller)) {
        whereClause += ` AND l.seller = ?`
        whereParams.push(seller.toLowerCase())
      } else {
        whereClause += ` AND EXISTS (SELECT 1 FROM users us WHERE us.wallet_address = l.seller AND us.name LIKE ?)`
        whereParams.push(`%${seller}%`)
      }
    }

    const orderBy =
      sort === 'price_asc'
        ? 'CAST(l.price AS DECIMAL(65,0)) ASC'
        : sort === 'price_desc'
        ? 'CAST(l.price AS DECIMAL(65,0)) DESC'
        : 'l.listed_at DESC'

    const [rows] = await pool.execute(
      `SELECT
         l.network_id, l.listing_id, l.seller AS wallet_address, l.collection, l.token_id,
         l.is_lsp8, l.payment_token, l.is_lsp7, CAST(l.price AS CHAR) AS price, l.referral_bps,
         l.status, l.listed_at,
         st.symbol, st.decimals,
         u.name AS display_name, u.profileImage AS profile_image
       FROM nft_listings l
       LEFT JOIN store_tokens st ON st.network_id = l.network_id AND st.token = l.payment_token
       LEFT JOIN users u ON u.wallet_address = l.seller
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
      [...whereParams, limit + 1, offset],
    )

    const hasMore = rows.length > limit
    const data = hasMore ? rows.slice(0, limit) : rows
    await fulfillUniversalProfiles(data, pool)

    return NextResponse.json({ success: true, data, meta: { page, hasMore } })
  } catch (error) {
    console.error('[GET_NFT_LISTINGS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

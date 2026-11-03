/**
 * @file api/v1/networks/statuses/route.js
 * @description Reads every wallet's live offchain Status from `user_statuses` — wallets the
 * viewer follows first, then newest first.
 * Statuses belong to a wallet rather than a chain, so network_id is accepted and ignored.
 * Backs the home page's "Status" tab.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { blockedFeedFilter, readUserBlocks } from '@/lib/blockUsers'
import { isEvmAddress } from '@/lib/address'

export const runtime = 'nodejs'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)

    const page = parseInt(searchParams.get('page')) || 1
    const limit = parseInt(searchParams.get('limit')) || 20
    const offset = (page - 1) * limit
    const viewerAddress = searchParams.get('viewer_address')

    // A viewer sees the wallets they follow first; without one, followed is 0 for every row
    const viewer = isEvmAddress(viewerAddress) ? viewerAddress.toLowerCase() : null
    let queryParams = [viewer]

    let query = `
      SELECT s.*, u.name AS display_name, u.username, u.profileImage AS profile_image,
        EXISTS (
          SELECT 1 FROM follows f
          WHERE f.follower_address = ? AND f.followed_address = s.wallet_address AND f.is_following = 1
        ) AS followed
      FROM user_statuses s
      LEFT JOIN users u ON u.wallet_address = s.wallet_address
      WHERE (s.expires_at IS NULL OR s.expires_at > UNIX_TIMESTAMP())
    `

    const blockFilter = blockedFeedFilter(await readUserBlocks(pool, viewerAddress), 's', false)
    query += blockFilter.sql
    queryParams.push(...blockFilter.params)

    query += ` ORDER BY followed DESC, s.updated_at DESC LIMIT ? OFFSET ?`
    queryParams.push(limit + 1, offset)

    const [rows] = await pool.execute(query, queryParams)

    const hasMore = rows.length > limit
    const statusesToSend = hasMore ? rows.slice(0, limit) : rows
    const nextPage = hasMore ? page + 1 : null

    return NextResponse.json({
      success: true,
      data: statusesToSend,
      nextPage,
      meta: {
        page,
        count: statusesToSend.length,
        hasMore,
      },
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('[STATUSES_FETCH_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to fetch statuses' }, { status: 500 })
  }
}

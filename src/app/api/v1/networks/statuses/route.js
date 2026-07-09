/**
 * @file api/v1/networks/statuses/route.js
 * @description Reads the latest non-cleared, non-expired on-chain Status per wallet
 * from the `statuses` table (populated by src/lib/statusChain.js), optionally
 * filtered by network_id. Backs the home page's "Status posts" tab.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)

    const page = parseInt(searchParams.get('page')) || 1
    const limit = parseInt(searchParams.get('limit')) || 20
    const offset = (page - 1) * limit
    const networkId = searchParams.get('network_id')

    let queryParams = []

    let query = `
      SELECT s.*, u.name AS display_name, u.profileImage AS profile_image
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY network_id, wallet_address ORDER BY event_timestamp DESC) AS rn
        FROM statuses
        WHERE is_cleared = 0
          AND (period_hours = 0 OR event_timestamp + period_hours * 3600 > UNIX_TIMESTAMP())
      ) s
      LEFT JOIN users u ON u.wallet_address = s.wallet_address
      WHERE s.rn = 1
    `

    if (networkId) {
      query += ` AND s.network_id = ?`
      queryParams.push(networkId)
    }

    query += ` ORDER BY s.event_timestamp DESC LIMIT ? OFFSET ?`
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
        filter_chain_id: networkId || 'all',
      },
    })
  } catch (error) {
    console.error('[STATUSES_FETCH_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to fetch statuses' }, { status: 500 })
  }
}

/**
 * @file api/v1/networks/statuses/route.js
 * @description Reads every wallet's live offchain Status from `user_statuses`, newest first.
 * Statuses belong to a wallet rather than a chain, so network_id is accepted and ignored.
 * Backs the home page's "Status" tab.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { blockedFeedFilter, readUserBlocks } from '@/lib/blockUsers'

export const runtime = 'nodejs'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)

    const page = parseInt(searchParams.get('page')) || 1
    const limit = parseInt(searchParams.get('limit')) || 20
    const offset = (page - 1) * limit
    const viewerAddress = searchParams.get('viewer_address')

    let queryParams = []

    let query = `
      SELECT s.*, u.name AS display_name, u.profileImage AS profile_image
      FROM user_statuses s
      LEFT JOIN users u ON u.wallet_address = s.wallet_address
      WHERE (s.expires_at IS NULL OR s.expires_at > UNIX_TIMESTAMP())
    `

    const blockFilter = blockedFeedFilter(await readUserBlocks(pool, viewerAddress), 's', false)
    query += blockFilter.sql
    queryParams.push(...blockFilter.params)

    query += ` ORDER BY s.updated_at DESC LIMIT ? OFFSET ?`
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

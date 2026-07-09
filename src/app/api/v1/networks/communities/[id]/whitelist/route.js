/**
 * @file api/v1/networks/communities/[id]/whitelist/route.js
 * @description Currently-whitelisted wallet list for a WhitelistGated community, indexed by cidex
 * from HupCommunity's WhitelistUpdated event. Read/display convenience only — actual gating still
 * runs on-chain via the `whitelist` mapping / `join()`.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(request, { params }) {
  try {
    const { id: communityId } = await params
    const { searchParams } = new URL(request.url)

    const page = parseInt(searchParams.get('page')) || 1
    const limit = Math.min(parseInt(searchParams.get('limit')) || 20, 50)
    const offset = (page - 1) * limit

    const networkId = searchParams.get('network_id')
    const contractAddress = searchParams.get('contract_address')

    if (!networkId || !contractAddress) {
      return NextResponse.json({ error: 'network_id and contract_address are required' }, { status: 400 })
    }

    const [rows] = await pool.execute(
      `SELECT wallet_address, updated_at
       FROM community_whitelist
       WHERE network_id = ? AND contract_address = ? AND community_id = ? AND is_whitelisted = 1
       ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      [networkId, contractAddress.toLowerCase(), communityId, limit + 1, offset],
    )

    const hasMore = rows.length > limit
    const rowsToSend = hasMore ? rows.slice(0, limit) : rows

    return NextResponse.json({
      success: true,
      data: rowsToSend,
      nextPage: hasMore ? page + 1 : null,
      meta: {
        page,
        count: rowsToSend.length,
        hasMore,
      },
    })
  } catch (error) {
    console.error('[COMMUNITY_WHITELIST_FETCH_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to fetch community whitelist' }, { status: 500 })
  }
}

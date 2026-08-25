/**
 * @file api/v1/networks/communities/[id]/route.js
 * @description Fetches a single indexed community by its on-chain id + network, mirroring
 * /api/v1/networks/[networkId]/[postId]'s pattern for post details — this is what lets the
 * community detail page (communities/[networkId]/[communityId]) show correct data regardless of
 * which chain the viewer's wallet happens to be connected to.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { attachCommunityExtras } from '@/lib/communityRows'
import { currentCommunityContract } from '@/lib/communityJoin'

export const runtime = 'nodejs'

export async function GET(request, { params }) {
  try {
    const { id: communityId } = await params
    const { searchParams } = new URL(request.url)
    const networkId = searchParams.get('network_id')
    const contractAddress = searchParams.get('contract_address')
    const viewerAddress = searchParams.get('viewer_address')

    if (!networkId) {
      return NextResponse.json({ error: 'network_id is required' }, { status: 400 })
    }

    let query = `
      SELECT
        c.*,
        (SELECT COUNT(*) FROM community_members m WHERE m.network_id = c.network_id AND m.contract_address = c.contract_address AND m.community_id = c.id AND m.is_member = 1 AND m.is_banned = 0) as member_count
      FROM communities c
      WHERE c.network_id = ? AND c.id = ?
    `
    const queryParams = [networkId, communityId]

    // (network_id, id) is NOT unique — `communities` is keyed by (network_id, contract_address,
    // id), so every HupCommunity deployment a chain has hosted contributes its own row per id,
    // and an unpinned LIMIT 1 answered with whichever the optimizer reached first (the detail
    // page showed a retired deployment's community #1 in place of the current one). An explicit
    // contract_address still wins, for looking a specific deployment up on purpose.
    const pinnedContract = contractAddress?.toLowerCase() || currentCommunityContract(networkId)
    if (pinnedContract) {
      query += ` AND c.contract_address = ?`
      queryParams.push(pinnedContract)
    }

    query += ` LIMIT 1`

    const [rows] = await pool.execute(query, queryParams)

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Community not found' }, { status: 404 })
    }

    // Same shape the directory returns, so the detail page can seed its CommunityCard from this
    // row instead of letting the card resolve the whole gating surface onchain again
    await attachCommunityExtras(rows, viewerAddress)

    return NextResponse.json({ success: true, data: rows[0] })
  } catch (error) {
    console.error('[COMMUNITY_FETCH_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to fetch community' }, { status: 500 })
  }
}

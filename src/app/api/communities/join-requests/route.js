// app/api/communities/join-requests/route.js
//
// The moderator queue for Request-Based communities. HupCommunity.sol's join() sets isPending=true
// onchain and emits MembershipRequested, which cidex indexes into community_members.is_pending by
// re-reading registry() — so this route is a pure read over chain-derived state.
//
// It used to be the other way round: the browser POSTed a row here after its join() tx confirmed,
// and DELETEd it after a moderator acted. That made the queue only as reliable as the tab that
// filed it — a closed tab, a dropped request, or a failed fetch left a wallet pending onchain that
// no moderator ever saw, and left phantom rows for wallets whose join() never landed. Both failure
// modes are structural, not fixable with retries, which is why the write path is gone entirely.

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const networkId = searchParams.get('network_id')
    const communityId = searchParams.get('community_id')
    const contractAddress = searchParams.get('contract_address')

    if (!networkId || !communityId || !contractAddress) {
      return NextResponse.json(
        { error: 'network_id, community_id and contract_address are required' },
        { status: 400 },
      )
    }

    // LOWER() on both sides: cidex stores checksummed addresses in binary-collated columns, so a
    // client passing a lowercased contract address would otherwise match nothing.
    const [rows] = await pool.execute(
      `SELECT wallet_address, updated_at AS requested_at
       FROM community_members
       WHERE network_id = ? AND LOWER(contract_address) = ? AND community_id = ?
         AND is_pending = 1 AND is_banned = 0
       ORDER BY updated_at ASC`,
      [networkId, contractAddress.toLowerCase(), communityId],
    )

    return NextResponse.json({ success: true, data: rows })
  } catch (e) {
    console.error('[JOIN_REQUESTS_FETCH_ERROR]:', e.message)
    return NextResponse.json({ success: false, error: 'Failed to fetch join requests' }, { status: 500 })
  }
}

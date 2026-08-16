// app/api/communities/join-requests/route.js
//
// Pure UI discovery index for Request-Based community join requests. HupCommunity.sol's join()
// sets isPending=true onchain (and emits MembershipRequested, which no indexer consumes yet), so
// moderators have no way to discover pending requests without this table. It is written by the
// client only after a join() tx confirms, and removed right after a moderator approves/rejects —
// it's not security-critical: actual authorization always comes from registry()/approveRequest.

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

let tableReady = null
function ensureTable() {
  if (!tableReady) {
    tableReady = pool.execute(`
      CREATE TABLE IF NOT EXISTS community_join_requests (
        network_id INT UNSIGNED NOT NULL,
        community_id BIGINT UNSIGNED NOT NULL,
        wallet_address VARCHAR(42) NOT NULL,
        requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (network_id, community_id, wallet_address)
      )
    `)
  }
  return tableReady
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const networkId = searchParams.get('network_id')
    const communityId = searchParams.get('community_id')

    if (!networkId || !communityId) {
      return NextResponse.json({ error: 'network_id and community_id are required' }, { status: 400 })
    }

    await ensureTable()
    const [rows] = await pool.execute(
      'SELECT wallet_address, requested_at FROM community_join_requests WHERE network_id = ? AND community_id = ? ORDER BY requested_at ASC',
      [networkId, communityId],
    )

    return NextResponse.json({ success: true, data: rows })
  } catch (e) {
    console.error('[JOIN_REQUESTS_FETCH_ERROR]:', e.message)
    return NextResponse.json({ success: false, error: 'Failed to fetch join requests' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const { networkId, communityId, walletAddress } = await request.json()
    if (!networkId || !communityId || !walletAddress) {
      return NextResponse.json({ error: 'networkId, communityId and walletAddress are required' }, { status: 400 })
    }

    await ensureTable()
    const [result] = await pool.execute(
      'INSERT IGNORE INTO community_join_requests (network_id, community_id, wallet_address) VALUES (?, ?, ?)',
      [networkId, communityId, walletAddress.toLowerCase()],
    )

    // Notify the creator + moderators. Done here rather than in cidex because the Request-Based
    // join() branch emits no on-chain event — this POST is the only signal a request exists.
    // Gated on affectedRows so a re-submitted (duplicate) request doesn't re-notify.
    if (result.affectedRows > 0) {
      try {
        const [communityRows] = await pool.execute(
          'SELECT creator_address, name FROM communities WHERE network_id = ? AND id = ? ORDER BY created_at DESC LIMIT 1',
          [networkId, communityId],
        )
        const community = communityRows[0]

        if (community) {
          const [moderatorRows] = await pool.execute(
            'SELECT wallet_address FROM community_members WHERE network_id = ? AND community_id = ? AND is_moderator = 1 AND is_banned = 0',
            [networkId, communityId],
          )

          const recipients = new Set(
            [community.creator_address, ...moderatorRows.map((row) => row.wallet_address)]
              .filter(Boolean)
              .map((addr) => addr.toLowerCase())
              .filter((addr) => addr !== walletAddress.toLowerCase()),
          )

          const communityName = community.name || `Community #${communityId}`
          const shortRequester = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`

          for (const recipient of recipients) {
            await pool.execute(
              `INSERT INTO notifications
                (recipient_wallet_address, actor_wallet_address, action_type, entity_type, entity_id,
                 network_id, title, message, action_url, data, push_status)
               VALUES (?, ?, 'community_join_requested', 'community', ?, ?, ?, ?, ?, ?, 'skipped')`,
              [
                recipient,
                walletAddress.toLowerCase(),
                String(communityId),
                networkId,
                'Join request',
                `${shortRequester} requested to join "${communityName}".`,
                `/communities/${networkId}/${communityId}`,
                JSON.stringify({ community_id: communityId, network_id: networkId, community_name: communityName }),
              ],
            )
          }
        }
      } catch (notifyErr) {
        // Notification failure never blocks the request itself
        console.error('[JOIN_REQUEST_NOTIFY_ERROR]:', notifyErr.message)
      }
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('[JOIN_REQUEST_CREATE_ERROR]:', e.message)
    return NextResponse.json({ success: false, error: 'Failed to record join request' }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url)
    const networkId = searchParams.get('network_id')
    const communityId = searchParams.get('community_id')
    const walletAddress = searchParams.get('wallet_address')

    if (!networkId || !communityId || !walletAddress) {
      return NextResponse.json({ error: 'network_id, community_id and wallet_address are required' }, { status: 400 })
    }

    await ensureTable()
    await pool.execute(
      'DELETE FROM community_join_requests WHERE network_id = ? AND community_id = ? AND wallet_address = ?',
      [networkId, communityId, walletAddress.toLowerCase()],
    )

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('[JOIN_REQUEST_DELETE_ERROR]:', e.message)
    return NextResponse.json({ success: false, error: 'Failed to remove join request' }, { status: 500 })
  }
}

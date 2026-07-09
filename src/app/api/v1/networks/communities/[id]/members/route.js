/**
 * @file api/v1/networks/communities/[id]/members/route.js
 * @description Member list for a community, indexed by cidex from HupCommunity's
 * MemberStatusUpdated/ModeratorUpdated events. Member rosters are private to moderators, so this
 * is a signed POST: the caller signs a short timestamped message, the server recovers the signer
 * address from the signature (never trusting a client-supplied address — same pattern as
 * /api/store/decrypt) and only serves the list if that address is the community's creator or an
 * active moderator. This is a read/display convenience only — actual gating still runs on-chain.
 */

import { NextResponse } from 'next/server'
import { recoverMessageAddress } from 'viem'
import pool from '@/lib/db'

export const runtime = 'nodejs'

const SIG_MAX_AGE_MS = 5 * 60 * 1000

export async function POST(request, { params }) {
  try {
    const { id: communityId } = await params
    const body = await request.json()
    const { network_id: networkId, contract_address: contractAddress, message, signature, role } = body

    const page = parseInt(body.page) || 1
    const limit = Math.min(parseInt(body.limit) || 20, 50)
    const offset = (page - 1) * limit

    if (!networkId || !contractAddress || !message || !signature) {
      return NextResponse.json(
        { error: 'network_id, contract_address, message and signature are required' },
        { status: 400 },
      )
    }

    // The signed message must name this exact community/network so a signature captured for one
    // community can't be replayed against another, and must be fresh.
    if (!message.startsWith(`Hup Community: view members of community ${communityId} on network ${networkId}`)) {
      return NextResponse.json({ error: 'Message does not match the expected action' }, { status: 400 })
    }
    const timestampMatch = message.match(/Timestamp:\s*(\d+)/)
    if (!timestampMatch) {
      return NextResponse.json({ error: 'Invalid message format' }, { status: 400 })
    }
    // Reject stale AND future-dated timestamps — a far-future timestamp would otherwise make a
    // leaked signature replayable until that date. 60s of allowance covers client clock skew.
    const signedAt = Number(timestampMatch[1])
    if (Date.now() - signedAt > SIG_MAX_AGE_MS || signedAt - Date.now() > 60 * 1000) {
      return NextResponse.json({ error: 'Signature expired' }, { status: 400 })
    }

    let signerAddress
    try {
      signerAddress = (await recoverMessageAddress({ message, signature })).toLowerCase()
    } catch {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    // Authorize: signer must be the community creator or an active moderator. LOWER() on both
    // sides because cidex stores checksummed addresses in binary-collated columns.
    const [authRows] = await pool.execute(
      `
        SELECT 1 FROM communities
        WHERE network_id = ? AND contract_address = ? AND id = ? AND LOWER(creator_address) = ?
        UNION
        SELECT 1 FROM community_members
        WHERE network_id = ? AND contract_address = ? AND community_id = ?
          AND LOWER(wallet_address) = ? AND is_moderator = 1 AND is_banned = 0
        LIMIT 1
      `,
      [
        networkId, contractAddress.toLowerCase(), communityId, signerAddress,
        networkId, contractAddress.toLowerCase(), communityId, signerAddress,
      ],
    )
    if (authRows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Only the community creator or moderators can view the member list' },
        { status: 403 },
      )
    }

    const roleFilter = role === 'moderator' ? 'AND is_moderator = 1 AND is_banned = 0' : 'AND is_member = 1 AND is_banned = 0'
    const [rows] = await pool.execute(
      `
        SELECT wallet_address, is_member, is_pending, is_moderator, is_banned, can_post, updated_at
        FROM community_members
        WHERE network_id = ? AND contract_address = ? AND community_id = ? ${roleFilter}
        ORDER BY updated_at DESC LIMIT ? OFFSET ?
      `,
      [networkId, contractAddress.toLowerCase(), communityId, limit + 1, offset],
    )

    const hasMore = rows.length > limit
    const membersToSend = hasMore ? rows.slice(0, limit) : rows

    return NextResponse.json({
      success: true,
      data: membersToSend,
      nextPage: hasMore ? page + 1 : null,
      meta: {
        page,
        count: membersToSend.length,
        hasMore,
      },
    })
  } catch (error) {
    console.error('[COMMUNITY_MEMBERS_FETCH_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to fetch community members' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json(
    { success: false, error: 'Member lists are private — POST a signed request (message + signature)' },
    { status: 405 },
  )
}

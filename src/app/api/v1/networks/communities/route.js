/**
 * @file api/v1/networks/communities/route.js
 * @description Searchable, paginated community directory — indexed by cidex from HupCommunity's
 * CommunityCreated/CommunityUpdated events. On-chain HupCommunity.communities(id) stays the
 * source of truth for gating and gets read directly wherever that matters; this route exists so
 * the directory doesn't need to iterate every community id client-side just to support search.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)

    const page = parseInt(searchParams.get('page')) || 1
    const limit = Math.min(parseInt(searchParams.get('limit')) || 20, 50)
    const offset = (page - 1) * limit

    const networkId = searchParams.get('network_id')
    const contractAddress = searchParams.get('contract_address')
    const membershipType = searchParams.get('membership_type')
    // Trimmed so a stray trailing space doesn't turn into `LIKE '%term %'` and match nothing
    const search = searchParams.get('search')?.trim()
    const creatorAddress = searchParams.get('creator_address')
    const viewerAddress = searchParams.get('viewer_address')

    // Cross-network directory mode: `contracts` is a comma-separated list of
    // `networkId:contractAddress` pairs (the client's current deployments). It replaces the
    // single network_id/contract_address filter, and pinning each network to its known contract
    // keeps stale rows from retired deployments out of the result.
    const contractPairs = (searchParams.get('contracts') || '')
      .split(',')
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const [pairNetworkId, pairAddress] = pair.split(':')
        return { networkId: pairNetworkId, address: pairAddress?.toLowerCase() }
      })
      .filter((pair) => pair.networkId && pair.address)

    if (!networkId && contractPairs.length === 0) {
      return NextResponse.json({ error: 'network_id or contracts is required' }, { status: 400 })
    }

    let whereClause
    const whereParams = []

    if (contractPairs.length > 0) {
      whereClause = ` WHERE (${contractPairs.map(() => '(c.network_id = ? AND c.contract_address = ?)').join(' OR ')})`
      for (const pair of contractPairs) {
        whereParams.push(pair.networkId, pair.address)
      }
    } else {
      whereClause = ` WHERE c.network_id = ?`
      whereParams.push(networkId)

      if (contractAddress) {
        whereClause += ` AND c.contract_address = ?`
        whereParams.push(contractAddress.toLowerCase())
      }
    }
    if (membershipType !== null && membershipType !== '' && membershipType !== undefined) {
      whereClause += ` AND c.membership_type = ?`
      whereParams.push(membershipType)
    }
    // Visibility split: "public" = plaintext-content types (Public, Whitelisted, Pay to Join),
    // "private" = the encrypted membership types — the same partition as communityVault's
    // isEncryptedMembershipType, so the filter matches the 🔒 tag users see on cards
    const visibility = searchParams.get('visibility')
    if (visibility === 'public') {
      whereClause += ` AND c.membership_type IN (0, 6, 7)`
    } else if (visibility === 'private') {
      whereClause += ` AND c.membership_type IN (1, 2, 3, 4, 5, 8)`
    }
    if (creatorAddress) {
      whereClause += ` AND c.creator_address = ?`
      whereParams.push(creatorAddress.toLowerCase())
    } else {
      // The public directory hides archived communities; a creator looking up their own
      // (via creator_address) can still see theirs regardless of status
      whereClause += ` AND c.is_active = 1`
    }
    if (search) {
      whereClause += ` AND (c.name LIKE ? OR c.summary LIKE ? OR c.description LIKE ?)`
      const searchTerm = `%${search}%`
      whereParams.push(searchTerm, searchTerm, searchTerm)
    }

    const [[{ total }]] = await pool.execute(`SELECT COUNT(*) as total FROM communities c${whereClause}`, whereParams)

    // Default sort surfaces the connected wallet's own communities first, without filtering the
    // rest of the directory out — viewer_address only affects ordering, unlike creator_address.
    // Ids are only monotonic within one contract, so the cross-network mode sorts by indexed
    // creation time instead.
    const baseOrder = contractPairs.length > 0 ? `c.created_at DESC, c.id DESC` : `c.id DESC`
    const orderClause = viewerAddress ? `ORDER BY (c.creator_address = ?) DESC, ${baseOrder}` : `ORDER BY ${baseOrder}`
    const orderParams = viewerAddress ? [viewerAddress.toLowerCase()] : []

    const [rows] = await pool.execute(
      `SELECT
        c.*,
        (SELECT COUNT(*) FROM community_members m WHERE m.network_id = c.network_id AND m.contract_address = c.contract_address AND m.community_id = c.id AND m.is_member = 1 AND m.is_banned = 0) as member_count
      FROM communities c${whereClause}
      ${orderClause} LIMIT ? OFFSET ?`,
      [...whereParams, ...orderParams, limit + 1, offset],
    )

    const hasMore = rows.length > limit
    const communitiesToSend = hasMore ? rows.slice(0, limit) : rows

    return NextResponse.json({
      success: true,
      data: communitiesToSend,
      nextPage: hasMore ? page + 1 : null,
      meta: {
        page,
        count: communitiesToSend.length,
        hasMore,
        total: Number(total),
      },
    })
  } catch (error) {
    console.error('[COMMUNITIES_FETCH_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to fetch communities' }, { status: 500 })
  }
}

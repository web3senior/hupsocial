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

    if (!networkId) {
      return NextResponse.json({ error: 'network_id is required' }, { status: 400 })
    }

    let whereClause = ` WHERE c.network_id = ?`
    const whereParams = [networkId]

    if (contractAddress) {
      whereClause += ` AND c.contract_address = ?`
      whereParams.push(contractAddress.toLowerCase())
    }
    if (membershipType !== null && membershipType !== '' && membershipType !== undefined) {
      whereClause += ` AND c.membership_type = ?`
      whereParams.push(membershipType)
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
    // rest of the directory out — viewer_address only affects ordering, unlike creator_address
    const orderClause = viewerAddress ? `ORDER BY (c.creator_address = ?) DESC, c.id DESC` : `ORDER BY c.id DESC`
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

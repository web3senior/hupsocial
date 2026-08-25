/**
 * @file api/v1/networks/communities/route.js
 * @description Searchable, paginated community directory — indexed by cidex from HupCommunity's
 * CommunityCreated/CommunityUpdated events. On-chain HupCommunity.communities(id) stays the
 * source of truth for gating and gets read directly wherever that matters; this route exists so
 * the directory doesn't need to iterate every community id client-side just to support search.
 *
 * It also carries everything the cards render — join gating, requirement chips, and the viewer's
 * own membership standing — so a page of twenty communities costs three queries here instead of
 * several hundred eth_calls spread across every deployed chain in the browser.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { attachCommunityExtras } from '@/lib/communityRows'
import { DEFAULT_COMMUNITY_CATEGORY, isCategorySlugShaped } from '@/config/communityCategories'

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
    // Visibility split by content encryption (the indexed is_encrypted flag, fed by
    // KeyInitialized events) — encryption is orthogonal to admission mode, so this matches
    // the 🔒 tag users see on cards exactly
    const visibility = searchParams.get('visibility')
    if (visibility === 'public') {
      whereClause += ` AND c.is_encrypted = 0`
    } else if (visibility === 'private') {
      whereClause += ` AND c.is_encrypted = 1`
    }
    // Category slug from `community_categories`, indexed by cidex from the metadata JSON. Only
    // shape-checked here: the list lives in the database, and a slug that isn't in it simply
    // matches no rows. 'other' also picks up rows with no category at all — communities created
    // before categories existed (or under a since-retired slug) file there, the same way the
    // card renders them.
    const category = searchParams.get('category')
    if (category && isCategorySlugShaped(category)) {
      if (category === DEFAULT_COMMUNITY_CATEGORY) {
        whereClause += ` AND (c.category = ? OR c.category IS NULL)`
      } else {
        whereClause += ` AND c.category = ?`
      }
      whereParams.push(category)
    }
    if (creatorAddress) {
      // LOWER() on both sides: cidex writes checksummed addresses into an ascii_bin column, so a
      // lowercased address compared directly against it matches nothing
      whereClause += ` AND LOWER(c.creator_address) = ?`
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
    const orderBy = (alias) => {
      const baseOrder = contractPairs.length > 0 ? `${alias}.created_at DESC, ${alias}.id DESC` : `${alias}.id DESC`
      return viewerAddress ? `ORDER BY (LOWER(${alias}.creator_address) = ?) DESC, ${baseOrder}` : `ORDER BY ${baseOrder}`
    }
    const orderParams = viewerAddress ? [viewerAddress.toLowerCase()] : []

    // The member count is counted over the page, not the whole filtered set: MariaDB evaluates a
    // select-list subquery for every row the WHERE matches, before LIMIT ever applies, so leaving
    // it in the outer select made the directory pay for a COUNT per community on the chain rather
    // than per community on screen. Ordering is repeated outside the derived table — a derived
    // table's row order isn't something the optimizer promises to carry through.
    const [rows] = await pool.execute(
      `SELECT
        page.*,
        (SELECT COUNT(*) FROM community_members m
          WHERE m.network_id = page.network_id AND m.contract_address = page.contract_address
            AND m.community_id = page.id AND m.is_member = 1 AND m.is_banned = 0) as member_count
      FROM (
        SELECT c.* FROM communities c${whereClause}
        ${orderBy('c')} LIMIT ? OFFSET ?
      ) AS page
      ${orderBy('page')}`,
      [...whereParams, ...orderParams, limit + 1, offset, ...orderParams],
    )

    const hasMore = rows.length > limit
    const communitiesToSend = hasMore ? rows.slice(0, limit) : rows

    // Requirement chips and the viewer's own membership standing — the last two things a card
    // used to resolve onchain for itself, one round trip per card
    await attachCommunityExtras(communitiesToSend, viewerAddress)

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

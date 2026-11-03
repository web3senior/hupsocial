/**
 * @file api/v1/networks/[networkId]/[postId]/comments/route.js
 * @description Fetches comments belonging to a specific parent post using the unified posts table layout.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'
import { parsePostContent, postRowSelect } from '@/lib/postRowQuery'

export const runtime = 'nodejs'

// Faces in a reply's "Show replies" stack, as Threads draws it
const REPLIERS_MAX = 3

/**
 * The newest distinct authors answering each of these replies, in one query for the whole page,
 * so the thread can draw its avatar stacks without a request per reply. Matches a child to its
 * reply the same two ways total_comments counts it (is_comment, or a non-zero parent_id).
 * @returns {Promise<Map<string, Array<{ wallet_address: string, display_name: string|null, profile_image: string|null }>>>}
 */
async function readRepliers(networkId, comments) {
  const byId = new Map()
  const ids = comments.filter((comment) => Number(comment.total_comments) > 0).map((comment) => comment.id)
  if (ids.length === 0) return byId

  const marks = ids.map(() => '?').join(', ')
  const [rows] = await pool.execute(
    `
      SELECT child.is_comment, child.parent_id, child.wallet_address, u.name AS display_name, u.profileImage AS profile_image
      FROM posts child
      LEFT JOIN users u ON child.wallet_address = u.wallet_address
      WHERE child.network_id = ?
        AND child.is_deleted = 0
        AND (child.is_comment IN (${marks}) OR (child.parent_id IN (${marks}) AND (child.content_type = 1 OR child.is_comment IS NOT NULL)))
      ORDER BY child.created_at DESC, child.id DESC
    `,
    [networkId, ...ids, ...ids]
  )

  const wanted = new Set(ids.map(String))
  for (const row of rows) {
    const key = wanted.has(String(row.is_comment)) ? String(row.is_comment) : String(row.parent_id)
    const faces = byId.get(key) ?? []
    if (faces.length >= REPLIERS_MAX || faces.some((face) => face.wallet_address === row.wallet_address)) continue
    faces.push({ wallet_address: row.wallet_address, display_name: row.display_name, profile_image: row.profile_image })
    byId.set(key, faces)
  }
  return byId
}

export async function GET(request, { params }) {
  try {
    const { networkId, postId } = await params
    const { searchParams } = new URL(request.url)

    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1)
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10), 1), 100)
    const offset = (page - 1) * limit
    const lastOnly = searchParams.get('last') === 'true'
    // 'top' ranks the thread the way Threads does — most liked, then most replied, oldest first
    // among ties; anything else keeps the chronological order. `last` (the newest-reply preview)
    // ignores it.
    const sortTop = !lastOnly && searchParams.get('sort') === 'top'
    const viewerAddress = searchParams.get('viewer_address')
    const contractAddress = searchParams.get('contract_address')?.toLowerCase() || null

    const queryParams = []
    if (viewerAddress) {
      queryParams.push(viewerAddress)
    }

    queryParams.push(networkId, postId, postId)
    if (contractAddress) {
      queryParams.push(contractAddress)
    }
    queryParams.push(lastOnly ? 1 : limit + 1, lastOnly ? 0 : offset)

    const query = `
      ${postRowSelect(Boolean(viewerAddress))}
      WHERE p.network_id = ?
        AND p.is_deleted = 0
        AND (p.content_type = 1 OR p.is_comment IS NOT NULL)
        AND (NULLIF(p.parent_id, 0) = ? OR p.is_comment = ?)
        ${contractAddress ? 'AND p.contract_address = ?' : ''}
      ORDER BY ${sortTop ? 'total_likes DESC, total_comments DESC, ' : ''}p.created_at ${lastOnly ? 'DESC' : 'ASC'}, p.id ${lastOnly ? 'DESC' : 'ASC'}
      LIMIT ? OFFSET ?
    `

    const [rows] = await pool.execute(query, queryParams)

    const hasMore = !lastOnly && rows.length > limit
    const commentsToSend = lastOnly ? rows : hasMore ? rows.slice(0, limit) : rows
    const nextPage = hasMore ? page + 1 : null

    // Fulfill any missing Universal Profile fields
    await fulfillUniversalProfiles(commentsToSend, pool)

    const repliers = lastOnly ? new Map() : await readRepliers(networkId, commentsToSend)

    return NextResponse.json({
      success: true,
      data: commentsToSend.map((comment) => ({
        ...comment,
        is_liked: Boolean(comment.has_liked),
        content: parsePostContent(comment.content),
        repliers: repliers.get(String(comment.id)) ?? [],
      })),
      nextPage,
    })
  } catch (error) {
    console.error('[GET_COMMENTS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to fetch comments' }, { status: 500 })
  }
}

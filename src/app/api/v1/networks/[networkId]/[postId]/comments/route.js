/**
 * @file api/v1/networks/[networkId]/[postId]/comments/route.js
 * @description Fetches comments belonging to a specific parent post using the unified posts table layout.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(request, { params }) {
  try {
    const { networkId, postId } = await params
    const { searchParams } = new URL(request.url)

    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1)
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10), 1), 100)
    const offset = (page - 1) * limit
    const lastOnly = searchParams.get('last') === 'true'
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
      SELECT
        p.*,
        u.name as display_name,
        u.profileImage as profile_image,
        n.name as network_name,
        n.explorer_url,
        (
          SELECT COUNT(*)
          FROM post_likes pl
          WHERE pl.post_id = p.id
            AND pl.network_id = p.network_id
            AND pl.contract_address <=> p.contract_address
            AND pl.is_active = 1
        ) as total_likes,
        (
          SELECT COUNT(*)
          FROM posts child
          WHERE child.network_id = p.network_id
            AND child.contract_address <=> p.contract_address
            AND child.is_deleted = 0
            AND (child.content_type = 1 OR child.is_comment IS NOT NULL)
            AND (NULLIF(child.parent_id, 0) = p.id OR child.is_comment = p.id)
        ) as total_comments,
        (
          SELECT COUNT(*)
          FROM post_views pv
          WHERE pv.post_id = p.id
            AND pv.network_id = p.network_id
        ) as total_views,
        ${viewerAddress ? `(
          SELECT EXISTS(
            SELECT 1
            FROM post_likes pl
            WHERE pl.post_id = p.id
              AND pl.network_id = p.network_id
              AND pl.contract_address <=> p.contract_address
              AND pl.liker_address = ?
              AND pl.is_active = 1
          )
        )` : '0'} as has_liked
      FROM posts p
      LEFT JOIN users u ON p.wallet_address = u.wallet_address
      JOIN networks n ON p.network_id = n.id
      WHERE p.network_id = ?
        AND p.is_deleted = 0
        AND (p.content_type = 1 OR p.is_comment IS NOT NULL)
        AND (NULLIF(p.parent_id, 0) = ? OR p.is_comment = ?)
        ${contractAddress ? 'AND p.contract_address = ?' : ''}
      ORDER BY p.created_at ${lastOnly ? 'DESC' : 'ASC'}, p.id ${lastOnly ? 'DESC' : 'ASC'}
      LIMIT ? OFFSET ?
    `

    const [rows] = await pool.execute(query, queryParams)

    const hasMore = !lastOnly && rows.length > limit
    const commentsToSend = lastOnly ? rows : hasMore ? rows.slice(0, limit) : rows
    const nextPage = hasMore ? page + 1 : null

    return NextResponse.json({
      success: true,
      data: commentsToSend.map((comment) => ({
        ...comment,
        is_liked: Boolean(comment.has_liked),
        content: parseIPFSContent(comment.content),
      })),
      nextPage,
    })
  } catch (error) {
    console.error('[GET_COMMENTS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to fetch comments' }, { status: 500 })
  }
}

/**
 * Helper to safely handle IPFS JSON data stored in the DB.
 */
function parseIPFSContent(content) {
  try {
    return JSON.parse(content)
  } catch (e) {
    return content
  }
}

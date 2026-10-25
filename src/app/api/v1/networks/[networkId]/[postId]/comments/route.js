/**
 * @file api/v1/networks/[networkId]/[postId]/comments/route.js
 * @description Fetches comments belonging to a specific parent post using the unified posts table layout.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'
import { parsePostContent, postRowSelect } from '@/lib/postRowQuery'

export const runtime = 'nodejs'

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

    return NextResponse.json({
      success: true,
      data: commentsToSend.map((comment) => ({
        ...comment,
        is_liked: Boolean(comment.has_liked),
        content: parsePostContent(comment.content),
      })),
      nextPage,
    })
  } catch (error) {
    console.error('[GET_COMMENTS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to fetch comments' }, { status: 500 })
  }
}

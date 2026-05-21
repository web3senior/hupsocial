/**
 * @file api/v1/networks/[networkId]/[postId]/comments/route.js
 * @description Fetches all comments belonging to a specific parent post using the unified posts table layout.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(request, { params }) {
  try {
    const { networkId, postId } = await params
    const { searchParams } = new URL(request.url)
    
    // Pagination parameters
    const page = parseInt(searchParams.get('page')) || 1
    const limit = parseInt(searchParams.get('limit')) || 20
    const offset = (page - 1) * limit

    // Viewer context for active user likes checking
    const viewerAddress = searchParams.get('viewer_address')

    let queryParams = []
    if (viewerAddress) {
      queryParams.push(viewerAddress)
    }
    
    // Bind the root postId to the is_comment column, filtered by the active network boundary
    queryParams.push(postId, networkId, limit + 1, offset)

    // Formulate chronological selection query with updated total_comments subquery
    const query = `
      SELECT 
        p.*,
        u.name as display_name,
        u.profileImage as profile_image,
        n.name as network_name,
        n.explorer_url,
        (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id AND network_id = p.network_id) as total_likes,
        (SELECT COUNT(*) FROM posts WHERE is_comment = p.id AND network_id = p.network_id) as total_comments,
        (SELECT COUNT(*) FROM post_views WHERE post_id = p.id) as total_views,
        ${viewerAddress ? `(SELECT EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND network_id = p.network_id AND liker = ?))` : '0'} as has_liked
      FROM posts p
      LEFT JOIN users u ON p.wallet_address = u.wallet_address
      JOIN networks n ON p.network_id = n.id
      WHERE p.is_comment = ? AND p.network_id = ?
      ORDER BY p.created_at ASC
      LIMIT ? OFFSET ?
    `

    const [rows] = await pool.execute(query, queryParams)

    // Infinite scroll evaluation metrics
    const hasMore = rows.length > limit
    const commentsToSend = hasMore ? rows.slice(0, limit) : rows
    const nextPage = hasMore ? page + 1 : null

    return NextResponse.json({
      success: true,
      data: commentsToSend.map(comment => ({
        ...comment,
        is_liked: Boolean(comment.has_liked),
        content: parseIPFSContent(comment.content)
      })),
      nextPage
    })

  } catch (error) {
    console.error('[GET_COMMENTS_ERROR]:', error.message)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch comments' }, 
      { status: 500 }
    )
  }
}

/**
 * Helper to safely handle IPFS JSON data stored in the DB
 */
function parseIPFSContent(content) {
  try { 
    return JSON.parse(content) 
  } catch (e) { 
    return content 
  }
}
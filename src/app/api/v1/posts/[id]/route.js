/**
 * @file api/v1/posts/[id]/route.js
 * @description Fetches a single post by its unique database ID with full metrics.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(request, { params }) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const viewerAddress = searchParams.get('viewer_address')

    let queryParams = [id]
    if (viewerAddress) queryParams.unshift(viewerAddress) // Add to front for the has_liked subquery

    /* SQL Logic:
       - p.id: Internal database ID
       - n.chain_id: The blockchain identifier
       - Subqueries: Calculate likes, comments, and views from separate tables
    */
    const query = `
      SELECT 
        p.*,
        n.name as network_name,
        n.chain_id,
        u.name as display_name,
        u.profileImage as profile_image,
        (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id AND network_id = p.network_id) as total_likes,
        (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id AND network_id = p.network_id) as total_comments,
        (SELECT COUNT(*) FROM post_views WHERE post_id = p.id) as total_views,
        ${viewerAddress ? `(SELECT EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND network_id = p.network_id AND liker = ?))` : '0'} as has_liked
      FROM posts p
      JOIN networks n ON p.network_id = n.id
      LEFT JOIN users u ON p.wallet_address = u.wallet_address
      WHERE p.id = ?
      LIMIT 1
    `

    const [rows] = await pool.execute(query, queryParams)

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Post not found' }, { status: 404 })
    }

    const post = rows[0]

    return NextResponse.json({
      success: true,
      data: {
        ...post,
        content: parseContent(post.content),
        has_liked: !!post.has_liked
      }
    })
  } catch (error) {
    console.error('[GET_POST_BY_ID_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

function parseContent(content) {
  try { return JSON.parse(content) } catch (e) { return content }
}
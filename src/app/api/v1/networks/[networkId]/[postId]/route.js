/**
 * @file api/v1/networks/[networkId]/posts/[postId]/route.js
 * @description Fetches a single post by its unique database ID and network context directly from the route layout parameters.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'

export const runtime = 'nodejs'

export async function GET(request, { params }) {
  try {
    // Extract both dynamic route tokens directly from the incoming parameters object
    const { networkId, postId } = await params
    const { searchParams } = new URL(request.url)
    const viewerAddress = searchParams.get('viewer_address')

    let queryParams = [postId, networkId]
    if (viewerAddress) {
      // Prepend the viewer address to align with the dynamic has_liked subquery position
      queryParams.unshift(viewerAddress)
    }

    // Select unified row structures using indexed relational bindings and direct aggregations
    const query = `
      SELECT 
        p.*,
        n.name as network_name,
        n.id as network_id,
        u.name as display_name,
        u.profileImage as profile_image,
        (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id AND network_id = p.network_id) as total_likes,
        (SELECT COUNT(*) FROM posts WHERE is_comment = p.id AND network_id = p.network_id) as total_comments,
        (SELECT COUNT(*) FROM post_views WHERE post_id = p.id) as total_views,
        ${viewerAddress ? `(SELECT EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND network_id = p.network_id AND liker_address = ?))` : '0'} as has_liked
      FROM posts p
      JOIN networks n ON p.network_id = n.id
      LEFT JOIN users u ON p.wallet_address = u.wallet_address
      WHERE p.id = ? AND n.id = ?
      LIMIT 1
    `

    const [rows] = await pool.execute(query, queryParams)

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Post not found' }, { status: 404 })
    }

    const post = rows[0]

    // Fulfill any missing Universal Profile fields
    await fulfillUniversalProfiles([post], pool)

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

/**
 * Helper to safely handle IPFS JSON data stored in the DB
 */
function parseContent(content) {
  try { 
    return JSON.parse(content) 
  } catch (e) { 
    return content 
  }
}
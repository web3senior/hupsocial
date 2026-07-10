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
      // Prepend the viewer address for each dynamic has_liked/has_bookmarked/folder_id/has_reposted/viewer_repost_id subquery position
      queryParams.unshift(viewerAddress, viewerAddress, viewerAddress, viewerAddress, viewerAddress)
    }

    // Select unified row structures using indexed relational bindings and direct aggregations.
    // total_reposts merges true reposts and quotes (X-style); quotes are matched via the quoteOf
    // key in their content JSON, so quotes sealed inside encrypted communities cannot be counted.
    const query = `
      SELECT
        p.*,
        n.name as network_name,
        n.id as network_id,
        u.name as display_name,
        u.profileImage as profile_image,
        comm.name as community_name,
        (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id AND network_id = p.network_id) as total_likes,
        (SELECT COUNT(*) FROM posts WHERE is_comment = p.id AND network_id = p.network_id) as total_comments,
        (SELECT COUNT(*) FROM posts WHERE is_repost = p.id AND network_id = p.network_id AND is_deleted = 0)
        + (SELECT COUNT(*) FROM posts q WHERE q.network_id = p.network_id AND q.is_deleted = 0
           AND CASE WHEN JSON_VALID(q.content) THEN JSON_UNQUOTE(JSON_EXTRACT(q.content, '$.quoteOf')) = CAST(p.id AS CHAR) ELSE 0 END) as total_reposts,
        (SELECT COUNT(*) FROM post_views WHERE post_id = p.id AND network_id = p.network_id) as total_views,
        (SELECT COUNT(*) FROM post_bookmarks WHERE post_id = p.id AND network_id = p.network_id) as total_bookmarks,
        (SELECT COUNT(*) FROM user_reports WHERE post_id = p.id AND network_id = p.network_id AND status = 'actioned') as actioned_reports,
        ${viewerAddress ? `(SELECT EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND network_id = p.network_id AND liker_address = ?))` : '0'} as has_liked,
        ${viewerAddress ? `(SELECT EXISTS(SELECT 1 FROM post_bookmarks WHERE post_id = p.id AND network_id = p.network_id AND wallet_address = ?))` : '0'} as has_bookmarked,
        ${viewerAddress ? `(SELECT folder_id FROM post_bookmarks WHERE post_id = p.id AND network_id = p.network_id AND wallet_address = ?)` : 'NULL'} as folder_id,
        ${viewerAddress ? `(SELECT EXISTS(SELECT 1 FROM posts WHERE is_repost = p.id AND network_id = p.network_id AND wallet_address = ? AND is_deleted = 0))` : '0'} as has_reposted,
        ${viewerAddress ? `(SELECT id FROM posts WHERE is_repost = p.id AND network_id = p.network_id AND wallet_address = ? AND is_deleted = 0 LIMIT 1)` : 'NULL'} as viewer_repost_id
      FROM posts p
      JOIN networks n ON p.network_id = n.id
      LEFT JOIN users u ON p.wallet_address = u.wallet_address
      LEFT JOIN communities comm ON comm.network_id = p.network_id AND comm.id = p.community_id
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
        has_liked: !!post.has_liked,
        is_bookmarked: !!post.has_bookmarked,
        folder_id: post.folder_id ?? null,
        has_reposted: !!post.has_reposted,
        viewer_repost_id: post.viewer_repost_id ?? null
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
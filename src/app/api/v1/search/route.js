import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const networkId = searchParams.get('network_id');
    const viewerAddress = searchParams.get('viewer_address');

    if (!query || query.length < 2) {
      return NextResponse.json({ success: true, data: [] });
    }

    const searchTerm = `%${query}%`;
    let queryParams = [];

    // Prepend viewer address if context is provided to check active interaction status
    if (viewerAddress) {
      queryParams.push(viewerAddress);
    }
    queryParams.push(searchTerm);

    // Formulate row selection injecting live metrics from the unified table layout
    let sql = `
      SELECT 
        p.*,
        u.name as display_name,
        u.profileImage as profile_image,
        n.name as network_name,
        n.id as network_id,
        n.explorer_url,
        (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id AND network_id = p.network_id) as total_likes,
        (SELECT COUNT(*) FROM posts WHERE is_comment = p.id AND network_id = p.network_id) as total_comments,
        (SELECT COUNT(*) FROM post_views WHERE post_id = p.id) as total_views,
        ${viewerAddress ? `(SELECT EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND network_id = p.network_id AND liker = ?))` : '0'} as has_liked
      FROM posts p
      LEFT JOIN users u ON p.wallet_address = u.wallet_address
      JOIN networks n ON p.network_id = n.id
      WHERE p.content LIKE ?
    `;

    if (networkId) {
      sql += ` AND n.network_id = ?`;
      queryParams.push(networkId);
    }

    sql += ` ORDER BY p.created_at DESC LIMIT 20`;

    const [rows] = await pool.execute(sql, queryParams);

    return NextResponse.json({
      success: true,
      data: rows.map(post => ({
        ...post,
        is_liked: Boolean(post.has_liked),
        content: parseIPFSContent(post.content)
      }))
    });
  } catch (error) {
    console.error('[SEARCH_FETCH_ERROR]:', error.message);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}

/**
 * Helper to safely handle IPFS JSON data stored in the DB
 */
function parseIPFSContent(content) {
  try { 
    return JSON.parse(content); 
  } catch (e) { 
    return content; 
  }
}
import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const chainId = searchParams.get('chain_id');

    if (!query || query.length < 2) {
      return NextResponse.json({ success: true, data: [] });
    }

    const searchTerm = `%${query}%`;
    let queryParams = [searchTerm];

    /* Match the homepage query structure for component compatibility */
    let sql = `
      SELECT 
        p.*,
        u.name as display_name,
        u.profileImage as profile_image,
        n.name as network_name,
        n.chain_id,
        n.explorer_url
      FROM posts p
      LEFT JOIN users u ON p.wallet_address = u.wallet_address
      JOIN networks n ON p.network_id = n.id
      WHERE p.content LIKE ?
    `;

    if (chainId) {
      sql += ` AND n.chain_id = ?`;
      queryParams.push(chainId);
    }

    sql += ` ORDER BY p.created_at DESC LIMIT 20`;

    const [rows] = await pool.execute(sql, queryParams);

    return NextResponse.json({
      success: true,
      data: rows.map(post => ({
        ...post,
        content: parseIPFSContent(post.content) // Safely handle JSON
      }))
    });
  } catch (error) {
    console.error('[SEARCH_FETCH_ERROR]:', error.message);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}

function parseIPFSContent(content) {
  try { return JSON.parse(content); } catch (e) { return content; }
}
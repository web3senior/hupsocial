/**
 * @file api/v1/users/[address]/following/route.js
 * @description Paginated list + total count of who a wallet follows, aggregated across every
 * network where LSP26FollowerSystem is deployed — see followers/route.js for why duplicates
 * across networks collapse into a single entry.
 */

import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(request, { params }) {
  try {
    const { address } = await params;
    const { searchParams } = new URL(request.url);

    if (!address) {
      return NextResponse.json({ success: false, error: 'Missing profile address' }, { status: 400 });
    }

    const page = parseInt(searchParams.get('page')) || 1;
    const limit = Math.min(parseInt(searchParams.get('limit')) || 20, 50);
    const offset = (page - 1) * limit;

    const source = address.toLowerCase();

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(DISTINCT followed_address) AS total FROM follows WHERE follower_address = ? AND is_following = 1`,
      [source],
    );

    const [rows] = await pool.execute(
      `SELECT followed_address, MAX(updated_at) AS followed_at
       FROM follows
       WHERE follower_address = ? AND is_following = 1
       GROUP BY followed_address
       ORDER BY followed_at DESC
       LIMIT ? OFFSET ?`,
      [source, limit + 1, offset],
    );

    const hasMore = rows.length > limit;
    const data = (hasMore ? rows.slice(0, limit) : rows).map((row) => row.followed_address);

    return NextResponse.json({
      success: true,
      data,
      meta: { page, count: data.length, hasMore, total: Number(total) },
    });
  } catch (error) {
    console.error('[FOLLOWING_FETCH_ERROR]:', error.message);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

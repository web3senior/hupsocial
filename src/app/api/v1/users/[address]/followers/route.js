/**
 * @file api/v1/users/[address]/followers/route.js
 * @description Paginated list + total count of a wallet's followers, aggregated across every
 * network where LSP26FollowerSystem is deployed (cidex indexes each network's rows into the
 * shared `follows` table). Since it's the identical contract deployed at the same address on
 * every chain, a wallet following the same address on two networks is still just one follower —
 * counted and listed once, not per-network.
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
    const viewerAddress = searchParams.get('viewer_address');

    const target = address.toLowerCase();

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(DISTINCT follower_address) AS total FROM follows WHERE followed_address = ? AND is_following = 1`,
      [target],
    );

    const [rows] = await pool.execute(
      `SELECT follower_address, MAX(updated_at) AS followed_at
       FROM follows
       WHERE followed_address = ? AND is_following = 1
       GROUP BY follower_address
       ORDER BY followed_at DESC
       LIMIT ? OFFSET ?`,
      [target, limit + 1, offset],
    );

    const hasMore = rows.length > limit;
    const data = (hasMore ? rows.slice(0, limit) : rows).map((row) => row.follower_address);

    let isFollowing = null;
    if (viewerAddress) {
      const [[{ match_found: matchFound }]] = await pool.execute(
        `SELECT EXISTS(
           SELECT 1 FROM follows WHERE follower_address = ? AND followed_address = ? AND is_following = 1
         ) AS match_found`,
        [viewerAddress.toLowerCase(), target],
      );
      isFollowing = Boolean(matchFound);
    }

    return NextResponse.json({
      success: true,
      data,
      isFollowing,
      meta: { page, count: data.length, hasMore, total: Number(total) },
    });
  } catch (error) {
    console.error('[FOLLOWERS_FETCH_ERROR]:', error.message);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

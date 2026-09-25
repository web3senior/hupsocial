/**
 * @file api/v1/networks/[networkId]/[postId]/likes/route.js
 * @description Lists who currently likes a post, newest like first, from the cidex-indexed
 * post_likes table.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { hasColumn } from '@/lib/schema'

export const runtime = 'nodejs'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

export async function GET(request, { params }) {
  try {
    const { networkId, postId } = await params
    if (!/^\d+$/.test(networkId) || !/^\d+$/.test(postId)) {
      return NextResponse.json({ success: false, error: 'Invalid post' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const page = Math.max(parseInt(searchParams.get('page')) || 1, 1)
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit')) || DEFAULT_LIMIT, 1), MAX_LIMIT)
    const offset = (page - 1) * limit

    const usernameColumn = (await hasColumn('users', 'username')) ? 'u.username AS username,' : ''

    // Same filter as total_likes in postRows, so the list agrees with the heart's count;
    // idx_post_likes_by_post_time serves both the filter and the order
    const [rows] = await pool.execute(
      `SELECT
        pl.liker_address AS wallet_address,
        TIMESTAMPDIFF(SECOND, '1970-01-01 00:00:00', pl.liked_at) AS liked_ts,
        ${usernameColumn}
        u.name AS display_name,
        u.profileImage AS profile_image
      FROM post_likes pl
      LEFT JOIN users u ON u.wallet_address = pl.liker_address
      WHERE pl.post_id = ? AND pl.network_id = ? AND pl.is_active = 1
      ORDER BY pl.liked_at DESC, pl.id DESC
      LIMIT ? OFFSET ?`,
      [postId, networkId, limit + 1, offset],
    )

    const [[totals]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM post_likes WHERE post_id = ? AND network_id = ? AND is_active = 1`,
      [postId, networkId],
    )

    const hasMore = rows.length > limit
    const likers = (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
      ...row,
      liked_ts: row.liked_ts == null ? null : Number(row.liked_ts),
    }))

    return NextResponse.json({
      success: true,
      data: likers,
      nextPage: hasMore ? page + 1 : null,
      meta: {
        page,
        count: likers.length,
        total: Number(totals?.total ?? 0),
        hasMore,
      },
    })
  } catch (error) {
    console.error('[GET_POST_LIKES_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

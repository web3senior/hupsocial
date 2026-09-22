/**
 * @file api/v1/users/suggested/route.js
 * @description A random handful of accounts for the home rail's "Who to follow": anyone with a
 * name and a picture, never the viewer, never someone they already follow on any chain.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { normalizeAddress } from '@/lib/address'

export const runtime = 'nodejs'

const MAX_LIMIT = 10

export async function GET(request) {
  try {
    const viewer = normalizeAddress(request.nextUrl.searchParams.get('viewer'))
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit')) || 3, 1), MAX_LIMIT)

    // Read as literals rather than joined: users and follows can differ in collation on production.
    const excluded = viewer ? [viewer] : []
    if (viewer) {
      const [followed] = await pool.execute(
        `SELECT DISTINCT followed_address FROM follows WHERE follower_address = ? AND is_following = 1`,
        [viewer],
      )
      excluded.push(...followed.map((row) => row.followed_address))
    }

    const [rows] = await pool.query(
      `SELECT wallet_address, name, username, profileImage
         FROM users
        WHERE wallet_address LIKE '0x%' AND CHAR_LENGTH(wallet_address) = 42
          AND name IS NOT NULL AND name <> ''
          AND profileImage IS NOT NULL AND profileImage <> ''
          ${excluded.length > 0 ? 'AND LOWER(wallet_address) NOT IN (?)' : ''}
        ORDER BY RAND()
        LIMIT ?`,
      excluded.length > 0 ? [excluded, limit] : [limit],
    )

    const users = rows.map((row) => ({
      address: row.wallet_address.toLowerCase(),
      name: row.name,
      username: row.username ?? null,
      profileImage: row.profileImage,
    }))

    // Every call is a fresh shuffle; a cached copy would pin the same faces to the rail.
    return NextResponse.json({ success: true, data: { users } }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[GET_SUGGESTED_USERS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

/**
 * @file api/v1/users/suggested/route.js
 * @description A random handful of accounts for the home feed's "Who to follow", drawn from the
 * leaderboard's top 20: anyone with a name and a picture, never the viewer, never someone they
 * already follow on any chain.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { normalizeAddress } from '@/lib/address'
import { getLeaderboardSnapshot } from '@/lib/leaderboard'

export const runtime = 'nodejs'

const MAX_LIMIT = 10

// The pool to suggest from: the leaderboard's own opening view (all time, by score, every
// network), cut at the rank the page's first screen ends on.
const TOP_RANK = 20

const isEvmAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(value ?? '')

export async function GET(request) {
  try {
    const viewer = normalizeAddress(request.nextUrl.searchParams.get('viewer'))
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit')) || 3, 1), MAX_LIMIT)

    // Read as literals rather than joined: users and follows can differ in collation on production.
    const excluded = new Set(viewer ? [viewer] : [])
    if (viewer) {
      const [followed] = await pool.execute(
        `SELECT DISTINCT followed_address FROM follows WHERE follower_address = ? AND is_following = 1`,
        [viewer],
      )
      for (const row of followed) excluded.add(String(row.followed_address).toLowerCase())
    }

    // Shared with /api/v1/leaderboard, cache and all, so the feed never pays for its own ranking.
    const snapshot = await getLeaderboardSnapshot({ period: 'all', sort: 'score', networkId: null, since: null })

    const candidates = snapshot.rows
      .slice(0, TOP_RANK)
      .filter(
        (row) =>
          isEvmAddress(row.wallet_address) &&
          row.display_name &&
          row.profile_image &&
          !excluded.has(String(row.wallet_address).toLowerCase()),
      )

    // Every call is a fresh shuffle; a fixed slice would pin the same faces to the feed.
    for (let i = candidates.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
    }

    const users = candidates.slice(0, limit).map((row) => ({
      address: row.wallet_address.toLowerCase(),
      name: row.display_name,
      username: row.username ?? null,
      profileImage: row.profile_image,
    }))

    return NextResponse.json({ success: true, data: { users } }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[GET_SUGGESTED_USERS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

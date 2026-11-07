/**
 * @file api/v1/users/community/route.js
 * @description Social proof for the connect-wallet popup: how many members Hup has, and a few
 * real faces to put next to the number.
 *
 * Members are wallets with a recorded Hup connection. Profile metadata alone cannot establish
 * membership: the users table also caches wallets discovered by the follower indexer.
 *
 * The faces are random on purpose — the strip should look alive, not curated — but they come from
 * the same population as the number, and only members carrying both a name and an avatar qualify:
 * three default silhouettes sell nothing. ORDER BY RAND() walks the table, and the count itself
 * moves slowly, so one query per TTL is plenty.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { resolveAvatarImageUrl } from '@/lib/storageHelper'
import { countMembers, memberFilter } from '@/lib/members'
import { hasColumn } from '@/lib/schema'

export const runtime = 'nodejs'

const FACE_COUNT = 3

/* The slot these are laid out in, not a width — the ladder picks the rung, so this URL is
   character-for-character the one <Avatar size={26}> asks for and the two share a cached object */
const FACE_SIZE = 26
const CACHE_TTL_MS = 60_000

let cache = { at: 0, payload: null }

export async function GET() {
  try {
    if (cache.payload && Date.now() - cache.at < CACHE_TTL_MS) {
      return NextResponse.json(cache.payload)
    }

    const members = memberFilter(null, await hasColumn('users', 'joined_at'))
    const [countRows, [faceRows]] = await Promise.all([
      countMembers(),
      pool.execute(
        `SELECT wallet_address, profileImage AS profile_image
           FROM users
          ${members.where}
            AND profileImage IS NOT NULL AND profileImage <> ''
            AND name IS NOT NULL AND name <> ''
          ORDER BY RAND()
          LIMIT ?`,
        [FACE_COUNT],
      ),
    ])

    const users = faceRows
      .map((row) => ({
        address: String(row.wallet_address),
        avatar: resolveAvatarImageUrl(row.profile_image, FACE_SIZE),
      }))
      .filter((user) => user.avatar)

    const payload = { success: true, data: { count: countRows.total, users } }
    cache = { at: Date.now(), payload }

    return NextResponse.json(payload)
  } catch (error) {
    console.error('[USERS_COMMUNITY_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

/**
 * @file api/v1/users/community/route.js
 * @description Social proof for the connect-wallet popup: how many members Hup has, and a few
 * real faces to put next to the number.
 *
 * "Member" is deliberately narrower than "row in users". That table doubles as the profile cache
 * the LSP26 follower indexer writes into, so the vast majority of its rows are addresses nobody
 * ever signed up as — no name, no avatar, no signature. Counting those inflated the claim by two
 * orders of magnitude, so both queries below filter on a profile actually existing.
 *
 * The faces are random on purpose — the strip should look alive, not curated — but they come from
 * the same population as the number, and only members carrying both a name and an avatar qualify:
 * three default silhouettes sell nothing. ORDER BY RAND() walks the table, and the count itself
 * moves slowly, so one query per TTL is plenty.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { resolveStorageImageUrl } from '@/lib/storageHelper'

export const runtime = 'nodejs'

const FACE_COUNT = 3
const AVATAR_WIDTH = 96
const CACHE_TTL_MS = 60_000

/* A row only counts as a member once it carries a profile — see the file header for why */
const HAS_PROFILE = `((name IS NOT NULL AND name <> '') OR (profileImage IS NOT NULL AND profileImage <> ''))`

let cache = { at: 0, payload: null }

export async function GET() {
  try {
    if (cache.payload && Date.now() - cache.at < CACHE_TTL_MS) {
      return NextResponse.json(cache.payload)
    }

    const [[countRows], [faceRows]] = await Promise.all([
      pool.execute(`SELECT COUNT(*) AS total FROM users WHERE ${HAS_PROFILE}`),
      pool.execute(
        `SELECT wallet_address, profileImage AS profile_image
           FROM users
          WHERE profileImage IS NOT NULL AND profileImage <> ''
            AND name IS NOT NULL AND name <> ''
          ORDER BY RAND()
          LIMIT ?`,
        [FACE_COUNT],
      ),
    ])

    const users = faceRows
      .map((row) => ({
        address: String(row.wallet_address),
        /* still: these are 26px circles — no reason to re-encode an animated GIF frame by frame */
        avatar: resolveStorageImageUrl(row.profile_image, { width: AVATAR_WIDTH, still: true }),
      }))
      .filter((user) => user.avatar)

    const payload = { success: true, data: { count: Number(countRows[0]?.total) || 0, users } }
    cache = { at: Date.now(), payload }

    return NextResponse.json(payload)
  } catch (error) {
    console.error('[USERS_COMMUNITY_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

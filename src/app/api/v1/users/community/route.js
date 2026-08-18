/**
 * @file api/v1/users/community/route.js
 * @description Social proof for the connect-wallet popup: how many wallets Hup has seen, and a
 * few real faces to put next to the number.
 *
 * The faces are random on purpose — the strip should look alive, not curated — but only users
 * with an actual avatar qualify, because three default silhouettes sell nothing. ORDER BY RAND()
 * walks the table, and the count itself moves slowly, so one query per TTL is plenty.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { resolveStorageImageUrl } from '@/lib/storageHelper'

export const runtime = 'nodejs'

const FACE_COUNT = 3
const AVATAR_WIDTH = 96
const CACHE_TTL_MS = 60_000

let cache = { at: 0, payload: null }

export async function GET() {
  try {
    if (cache.payload && Date.now() - cache.at < CACHE_TTL_MS) {
      return NextResponse.json(cache.payload)
    }

    const [[countRows], [faceRows]] = await Promise.all([
      pool.execute('SELECT COUNT(*) AS total FROM users'),
      pool.execute(
        `SELECT wallet_address, profileImage AS profile_image
           FROM users
          WHERE profileImage IS NOT NULL AND profileImage <> ''
          ORDER BY RAND()
          LIMIT ?`,
        [FACE_COUNT],
      ),
    ])

    const users = faceRows
      .map((row) => ({
        address: String(row.wallet_address),
        avatar: resolveStorageImageUrl(row.profile_image, { width: AVATAR_WIDTH }),
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

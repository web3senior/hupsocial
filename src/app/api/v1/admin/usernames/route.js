/**
 * @file api/v1/admin/usernames/route.js
 * @description How the handle namespace is filling up: how many wallets hold one, how many took
 * or changed theirs lately, how many released handles are still locked, and who claimed last.
 * Aggregates and public profile facts only, so the read is unsigned; the admin page gates who
 * looks, nothing here is a secret.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { hasColumn, hasTable } from '@/lib/schema'
import { USERNAME_RELEASE_LOCK_DAYS } from '@/lib/username'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LATEST_LIMIT = 10

// Shaped like a post row so the client can hand it to profileFallbackFromRow as is
const toClaim = (row) => ({
  wallet_address: row.wallet_address,
  display_name: row.name,
  profile_image: row.profileImage,
  username: row.username,
  at: row.username_changed_at,
})

export async function GET() {
  try {
    if (!(await hasColumn('users', 'username_key'))) {
      return NextResponse.json({ success: true, data: { migrated: false } })
    }

    // username_changed_at is re-stamped by a change too, so "recent" counts claims and changes alike
    const [[counts]] = await pool.execute(
      `SELECT COUNT(*) AS users,
              COUNT(username_key) AS claimed,
              COALESCE(SUM(username_changed_at >= NOW() - INTERVAL 1 DAY), 0) AS day,
              COALESCE(SUM(username_changed_at >= NOW() - INTERVAL 7 DAY), 0) AS week,
              COALESCE(SUM(username_changed_at >= NOW() - INTERVAL 30 DAY), 0) AS month
       FROM users`,
    )

    const [latest] = await pool.execute(
      `SELECT wallet_address, name, profileImage, username, username_changed_at
       FROM users
       WHERE username_key IS NOT NULL
       ORDER BY username_changed_at DESC
       LIMIT ${LATEST_LIMIT}`,
    )

    let locked = 0
    if (await hasTable('username_history')) {
      const [[row]] = await pool.execute(
        `SELECT COUNT(*) AS locked FROM username_history WHERE released_at >= NOW() - INTERVAL ${USERNAME_RELEASE_LOCK_DAYS} DAY`,
      )
      locked = Number(row.locked)
    }

    return NextResponse.json({
      success: true,
      data: {
        migrated: true,
        users: Number(counts.users),
        claimed: Number(counts.claimed),
        recent: { day: Number(counts.day), week: Number(counts.week), month: Number(counts.month) },
        locked,
        lockDays: USERNAME_RELEASE_LOCK_DAYS,
        latest: latest.map(toClaim),
      },
    })
  } catch (err) {
    console.error('ADMIN_USERNAMES_ERROR:', err.message)
    return NextResponse.json({ success: false, error: 'Could not read username stats.' }, { status: 500 })
  }
}

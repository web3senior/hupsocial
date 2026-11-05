/**
 * @file lib/achievementStanding.js
 * @description Community standing — the only way an achievement goes out of view, and one the
 * community decides, never an admin. A wallet blocked by COMMUNITY_STANDING.blockedByOg different
 * OG holders is in bad standing: it earns no automatic achievement, and the ones it holds stop
 * showing until enough of those blocks are lifted. Nothing is deleted, so standing is read live.
 *
 * Only OG holders count as blockers: they are the accounts with the longest, most active record
 * here, so fresh wallets cannot gang up on anyone. Self-blocks count for nothing. Addresses
 * compare through LOWER() on both sides — blocks and awards are written by different code paths.
 */

import pool from '@/lib/db'
import { isEvmAddress, normalizeAddress } from '@/lib/address'
import { hasTable } from '@/lib/schema'
import { COMMUNITY_STANDING } from '@/config/achievements'

const collate = (column) => `CONVERT(${column} USING utf8mb4) COLLATE utf8mb4_general_ci`

const blockedByOgSql = (only = '') => `
  SELECT LOWER(b.blocked_address) AS wallet FROM user_blocks b
  JOIN user_achievements og ON og.wallet_address = ${collate('LOWER(b.blocker_address)')}
    AND og.achievement_id = 'og' AND og.scope = ''
  WHERE LOWER(b.blocker_address) <> LOWER(b.blocked_address) ${only}
  GROUP BY LOWER(b.blocked_address)
  HAVING COUNT(DISTINCT LOWER(b.blocker_address)) >= ?`

// Before either table exists nobody can have been blocked by an OG holder.
const ready = async () => (await hasTable('user_blocks')) && (await hasTable('user_achievements'))

/** Every wallet in bad standing right now, lowercase. */
export async function readBadStanding() {
  if (!(await ready())) return new Set()
  const [rows] = await pool.execute(blockedByOgSql(), [COMMUNITY_STANDING.blockedByOg])
  return new Set(rows.map((row) => row.wallet))
}

/** Whether one wallet is in bad standing — a narrow read for the profile path. */
export async function isInBadStanding(address) {
  const wallet = normalizeAddress(address)
  if (!isEvmAddress(wallet) || !(await ready())) return false
  const [rows] = await pool.execute(blockedByOgSql(`AND ${collate('LOWER(b.blocked_address)')} = ${collate('?')}`), [wallet, COMMUNITY_STANDING.blockedByOg])
  return rows.length > 0
}

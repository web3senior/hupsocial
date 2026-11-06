/**
 * @file lib/socialFollows.js
 * @description Server side of offchain following (config/socialGraph.js): validating and writing
 * follow rows, and telling the browser which of a list of accounts the viewer follows, and how.
 */

import { isEvmAddress, normalizeAddress } from './address'
import {
  MAX_FOLLOW_TARGETS,
  OFFCHAIN_FOLLOW_CONTRACT,
  OFFCHAIN_FOLLOW_NETWORK_ID,
  SOCIAL_GRAPH_CHAIN_ID,
  socialGraphAddress,
} from '@/config/socialGraph'

export class FollowError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

/** Lowercased, deduplicated, valid addresses other than `self`; throws on anything else. */
export function parseFollowTargets(input, self = null) {
  const list = Array.isArray(input) ? input : typeof input === 'string' ? input.split(',') : []
  const targets = [...new Set(list.map((value) => normalizeAddress(String(value).trim())))].filter((value) => value && value !== self)
  if (targets.length === 0) throw new FollowError('Name at least one account')
  if (targets.length > MAX_FOLLOW_TARGETS) throw new FollowError(`Follow up to ${MAX_FOLLOW_TARGETS} accounts at a time`)
  if (!targets.every(isEvmAddress)) throw new FollowError('Every account must be a wallet address')
  return targets
}

/*
 * Notifies only the first time a pair is ever followed: a re-follow after an unfollow is silent, so
 * toggling cannot be used to ping someone over and over. Best effort — the follow has already landed.
 */
const notifyFollowed = async (db, follower, followed) => {
  try {
    await db.execute(
      `INSERT INTO notifications (recipient_wallet_address, actor_wallet_address, action_type, entity_type, entity_id, title, message, action_url, data, push_status, email_status)
       VALUES (?, ?, 'user_received_follow', 'user', ?, 'New follower', ?, ?, ?, 'pending', 'skipped')`,
      [
        followed,
        follower,
        follower,
        `${follower.slice(0, 6)}...${follower.slice(-4)} started following you.`,
        `/${follower}`,
        JSON.stringify({ follower_address: follower, offchain: true }),
      ],
    )
  } catch (error) {
    console.warn('[follows] notification failed:', error.message)
  }
}

/**
 * Follows or unfollows `targets` as `follower`. Unfollowing an account the follower never followed
 * offchain is a no-op; an onchain LUKSO follow is left to the browser, which sends that unfollow.
 * @returns {Promise<string[]>} The targets whose row changed.
 */
export async function setFollows(db, follower, targets, following) {
  const changed = []

  for (const target of targets) {
    if (following) {
      // Read first rather than upsert: mysql2 reports found rows, so an upsert cannot tell new from unchanged
      const [[row]] = await db.execute(
        `SELECT is_following FROM follows WHERE network_id = ? AND contract_address = ? AND follower_address = ? AND followed_address = ?`,
        [OFFCHAIN_FOLLOW_NETWORK_ID, OFFCHAIN_FOLLOW_CONTRACT, follower, target],
      )
      if (Number(row?.is_following) === 1) continue

      if (row) {
        await db.execute(
          `UPDATE follows SET is_following = 1, updated_at = UTC_TIMESTAMP()
           WHERE network_id = ? AND contract_address = ? AND follower_address = ? AND followed_address = ?`,
          [OFFCHAIN_FOLLOW_NETWORK_ID, OFFCHAIN_FOLLOW_CONTRACT, follower, target],
        )
      } else {
        // IGNORE: a double tap racing this one has already written the row
        const [result] = await db.execute(
          `INSERT IGNORE INTO follows (network_id, contract_address, follower_address, followed_address, is_following, updated_at)
           VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP())`,
          [OFFCHAIN_FOLLOW_NETWORK_ID, OFFCHAIN_FOLLOW_CONTRACT, follower, target],
        )
        if (result.affectedRows === 1) await notifyFollowed(db, follower, target)
      }
      changed.push(target)
    } else {
      const [result] = await db.execute(
        `UPDATE follows SET is_following = 0, updated_at = UTC_TIMESTAMP()
         WHERE network_id = ? AND contract_address = ? AND follower_address = ? AND followed_address = ? AND is_following = 1`,
        [OFFCHAIN_FOLLOW_NETWORK_ID, OFFCHAIN_FOLLOW_CONTRACT, follower, target],
      )
      if (result.affectedRows > 0) changed.push(target)
    }
  }

  return changed
}

/**
 * Which of `targets` the viewer follows. `following` is every way of following (offchain, LUKSO, or
 * an older follow on another chain); `onchain` is the subset followed on LUKSO's LSP26, which an
 * unfollow has to undo there too.
 * @returns {Promise<{following: string[], onchain: string[], offchain: string[]}>}
 */
export async function readFollowRelations(db, viewer, targets) {
  const placeholders = targets.map(() => '?').join(',')
  const [rows] = await db.execute(
    `SELECT followed_address,
       MAX(network_id = ? AND contract_address = ?) AS onchain,
       MAX(network_id = ? AND contract_address = ?) AS offchain
     FROM follows
     WHERE follower_address = ? AND is_following = 1 AND followed_address IN (${placeholders})
     GROUP BY followed_address`,
    [SOCIAL_GRAPH_CHAIN_ID, socialGraphAddress(), OFFCHAIN_FOLLOW_NETWORK_ID, OFFCHAIN_FOLLOW_CONTRACT, viewer, ...targets],
  )

  return {
    following: rows.map((row) => row.followed_address),
    onchain: rows.filter((row) => Number(row.onchain) === 1).map((row) => row.followed_address),
    offchain: rows.filter((row) => Number(row.offchain) === 1).map((row) => row.followed_address),
  }
}

/** Every account the viewer follows, by any route, lowercased. */
export async function readFollowingAddresses(db, viewer) {
  const [rows] = await db.execute(`SELECT DISTINCT followed_address FROM follows WHERE follower_address = ? AND is_following = 1`, [viewer])
  return rows.map((row) => String(row.followed_address).toLowerCase())
}

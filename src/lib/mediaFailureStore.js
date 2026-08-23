/**
 * @file lib/mediaFailureStore.js
 * @description The durable half of the media proxies' negative cache — the layer under
 * lib/mediaCache.js, backed by the `media_failures` table (DDL in
 * sql/2026-08-23-media-failures.sql).
 *
 * mediaCache remembers a dead content address in the process, which is exactly right for a
 * long-lived server and no help at all on a serverless one: every cold instance starts having
 * never heard of any of them, and eats the proxy's full gateway timeout relearning it. The
 * shared CDN doesn't cover the gap either, because it caches successes, not 504s.
 *
 * So the fact that an address is unresolvable is written down where every instance can read
 * it. The NFT Market's collections ranking is what made this worth building: twelve icons,
 * five of them long unpinned, 8.5–10s apiece — the table's own figures come back in 20ms.
 *
 * Every call degrades to a warning. A database that is down must slow the proxy back to what
 * it was, never break it.
 */

import pool from '@/lib/db'

/**
 * How long a recorded failure is believed. Longer than mediaCache's in-process ten minutes,
 * because the point of this layer is to survive the instance that learned it — and short
 * enough that the one case this gets wrong, a gateway that was merely having a bad minute,
 * costs a blank thumbnail for half an hour rather than a working day.
 */
export const DURABLE_FAILURE_TTL_MS = 30 * 60 * 1000

/**
 * Primary-key ceiling. utf8mb4 spends four bytes a character, so 255 is the longest a
 * varchar key stays inside InnoDB's index limit. A longer key is dropped rather than
 * truncated: two transforms of one CID would truncate to the same string, and the second
 * would inherit a verdict that was never about it.
 */
const MAX_KEY_LENGTH = 255

/**
 * Whether this key is known to be unresolvable.
 * @param {string} cacheKey The proxy's cache key — cid plus every transform param.
 * @returns {Promise<{status: number, message: string}|null>} The failure to replay, or null
 * if the key is unknown, its record has expired, or the database could not be reached.
 */
export async function readDurableFailure(cacheKey) {
  if (!cacheKey || cacheKey.length > MAX_KEY_LENGTH) return null

  try {
    const [rows] = await pool.execute(
      `SELECT status, message
         FROM media_failures
        WHERE cache_key = ? AND failed_at > NOW() - INTERVAL ? SECOND
        LIMIT 1`,
      [cacheKey, Math.floor(DURABLE_FAILURE_TTL_MS / 1000)],
    )

    const row = rows[0]
    return row ? { status: Number(row.status), message: row.message || 'Media could not be resolved' } : null
  } catch (error) {
    console.warn('[media-failure-store] read failed, falling through to the gateway:', error.message)
    return null
  }
}

/**
 * Records that this key could not be resolved, restarting its TTL if it was already known.
 *
 * Awaited by the caller only so a failure to write is visible in the logs — the response it
 * belongs to is already decided by the time this runs.
 * @param {Object} params
 * @param {string} params.cacheKey The proxy's cache key.
 * @param {string} params.cid The content address, kept alongside for triage.
 * @param {number} params.status Status to replay on a later hit.
 * @param {string} params.message Error text to replay.
 * @returns {Promise<void>}
 */
export async function recordDurableFailure({ cacheKey, cid, status, message }) {
  if (!cacheKey || cacheKey.length > MAX_KEY_LENGTH) return

  try {
    await pool.execute(
      `INSERT INTO media_failures (cache_key, cid, status, message, failed_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         status = VALUES(status),
         message = VALUES(message),
         failed_at = VALUES(failed_at)`,
      [cacheKey, String(cid).slice(0, MAX_KEY_LENGTH), status, message ? String(message).slice(0, 255) : null],
    )
  } catch (error) {
    console.warn('[media-failure-store] write failed, this CID will be retried:', error.message)
  }
}

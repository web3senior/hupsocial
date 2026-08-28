/**
 * @file lib/mediaFailureStore.js
 * @description The durable half of the media proxies' negative cache — the layer under
 * lib/mediaCache.js, backed by the `media_failures` table. The DDL ships with the rest of
 * the shared schema in cidex/scripts/add-media-failures.sql.
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
 * The same, for a row that only ever meant "nobody found it in time".
 *
 * The recorded `status` carries which of the two it was, written by the proxy's recordFailure:
 * 502 for gateways that answered about the content (a refusal, or a transfer that stalled with
 * the file unfinished), 504 for gateways that never got that far. Half an hour is the right
 * hold for the first and much too long for the second — provider discovery fails on content
 * that is merely slow to locate, and two Universal Profile pictures spent their half hour as
 * the default avatar while serving perfectly well again minutes in.
 *
 * Rows written before this distinction existed are all 504s, so they age out on the short
 * clock: the failure they recorded is the one most likely to have stopped being true.
 */
export const DURABLE_DISCOVERY_TTL_MS = 5 * 60 * 1000

/**
 * The same again, for a row that means the content itself is gone.
 *
 * The two TTLs above are both hedges against a gateway having had a bad minute. This one is not
 * a hedge: the proxy asks the DHT who advertises the CID, and a row is written with this status
 * only when the answer is nobody. There is no host whose luck could change, so the retry the
 * short clocks exist to allow would be spent relearning the same fact — for four of the NFT
 * market's collection icons, every few minutes, forever.
 *
 * Half a day, not permanent, because a creator can re-pin their artwork and the routing layer
 * can be wrong in the quiet direction.
 */
export const DURABLE_DEAD_TTL_MS = 12 * 60 * 60 * 1000

/** The status recordFailure writes when no gateway ever found the content. */
const UNDISCOVERED_STATUS = 504

/** The status recordFailure writes when the DHT knows of no provider at all. */
const DEAD_STATUS = 410

/**
 * Primary-key ceiling. utf8mb4 spends four bytes a character, so 255 is the longest a
 * varchar key stays inside InnoDB's index limit. A longer key is dropped rather than
 * truncated: two transforms of one CID would truncate to the same string, and the second
 * would inherit a verdict that was never about it.
 */
const MAX_KEY_LENGTH = 255

/**
 * Whether this key is known to be unresolvable, on the clock its class earns.
 * @param {string} cacheKey The proxy's cache key — cid plus every transform param.
 * @returns {Promise<{status: number, message: string}|null>} The failure to replay, or null
 * if the key is unknown, its record has expired, or the database could not be reached.
 */
export async function readDurableFailure(cacheKey) {
  if (!cacheKey || cacheKey.length > MAX_KEY_LENGTH) return null

  try {
    /* The age is compared server-side, in one expression, deliberately. Reading `failed_at`
       back and subtracting it here would measure it against this process's clock and this
       connection's timezone — a Vercel function in UTC against a database that is not would
       expire every row early or none of them. */
    const [rows] = await pool.execute(
      `SELECT status, message
         FROM media_failures
        WHERE cache_key = ?
          AND failed_at > NOW() - INTERVAL (CASE status WHEN ? THEN ? WHEN ? THEN ? ELSE ? END) SECOND
        LIMIT 1`,
      [
        cacheKey,
        UNDISCOVERED_STATUS,
        Math.floor(DURABLE_DISCOVERY_TTL_MS / 1000),
        DEAD_STATUS,
        Math.floor(DURABLE_DEAD_TTL_MS / 1000),
        Math.floor(DURABLE_FAILURE_TTL_MS / 1000),
      ],
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

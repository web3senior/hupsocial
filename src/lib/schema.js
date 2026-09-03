/**
 * @file lib/schema.js
 * @description Asking the database what it actually has.
 *
 * Production is migrated by hand, so a column can exist here and not there for as long as it
 * takes someone to run the .sql. A feature whose column has not landed yet has to be able to ask
 * rather than let one missing field reject the whole statement — that is how a decoration takes
 * a profile save, or a whole feed, down with it.
 */

import pool from '@/lib/db'

/* A "yes" is kept for the life of the process — a column cannot un-exist. A "no" is re-probed, so
   applying a migration to a live database starts working on its own, without a redeploy to
   recycle the instance. */
const PROBE_RETRY_MS = 5 * 60_000

const probes = new Map()

/**
 * Whether a column exists on a table in the current database.
 * @param {string} table Table name.
 * @param {string} column Column name.
 * @returns {Promise<boolean>} True when the column is there.
 */
export async function hasColumn(table, column) {
  const key = `${table}.${column}`
  const probe = probes.get(key)
  if (probe?.present) return true
  if (probe && Date.now() - probe.probedAt < PROBE_RETRY_MS) return false

  try {
    const [rows] = await pool.execute(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
      [table, column],
    )
    probes.set(key, { present: rows.length > 0, probedAt: Date.now() })
    return rows.length > 0
  } catch (error) {
    /* A failed probe says nothing about the column — a real connection problem surfaces on the
       caller's own query a moment later, where it belongs. */
    console.error(`[schema] probe for ${key} failed:`, error.message)
    probes.set(key, { present: false, probedAt: Date.now() })
    return false
  }
}

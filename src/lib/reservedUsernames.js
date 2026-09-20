/**
 * @file lib/reservedUsernames.js
 * @description The curated half of the reserved-handle list: brands, chains, protocols and the
 * industry's vocabulary, read from the reserved_usernames table so a name can be held or released
 * with a row instead of a deploy. The structural floor — routes and impersonation names — stays in
 * lib/username.js, where the browser can refuse it as it is typed.
 *
 * Server only: it reads the database.
 */

import pool from '@/lib/db'
import { hasTable } from '@/lib/schema'

const TABLE = 'reserved_usernames'

/* Long enough that the typed-availability check never queries per keystroke, short enough that a
   row added by hand is honoured without a restart. The same window schema.js re-probes on. */
const REFRESH_MS = 5 * 60_000

let keys = new Set()
let loadedAt = 0
let refreshing = null

/* Reads as empty until the table has landed — production is migrated by hand, and the floor in
   username.js still holds in the meantime. */
async function load() {
  if (!(await hasTable(TABLE))) return new Set()
  const [rows] = await pool.execute(`SELECT username_key FROM ${TABLE} WHERE is_active = 1`)
  return new Set(rows.map((row) => row.username_key))
}

const refresh = () =>
  load()
    .then((next) => {
      keys = next
    })
    .catch((error) => {
      /* The last good list stays in service; a real connection problem surfaces on the caller's
         own query a moment later, where it belongs. */
      console.error('[reservedUsernames] refresh failed:', error.message)
    })
    .finally(() => {
      loadedAt = Date.now()
      refreshing = null
    })

/**
 * Whether a folded handle is held back by the table.
 * @param {string} key The handle in usernameKey() form.
 * @returns {Promise<boolean>}
 */
export async function isReservedUsername(key) {
  if (Date.now() - loadedAt > REFRESH_MS) {
    /* One refresh at a time; concurrent checks share it rather than each hitting the table. */
    refreshing ??= refresh()
    await refreshing
  }
  return keys.has(key)
}

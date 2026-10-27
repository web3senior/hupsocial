/**
 * @file lib/rolesServer.js
 * @description Server-only reads and writes for admin-given roles (lib/roles.js). A role is
 * decoration beside a name, so every read degrades to "no roles" — a database that has not run
 * cidex/scripts/add-user-roles.sql must never 500 a profile.
 */

import pool from '@/lib/db'
import { normalizeAddress } from '@/lib/address'
import { hasTable } from '@/lib/schema'
import { isRole } from '@/lib/roles'

const TABLE = 'user_roles'

// No realistic program has more members than one admin list can show at once.
const LIST_LIMIT = 500

/**
 * The roles one wallet holds, as slugs this build knows — a retired slug still in the table
 * simply stops rendering.
 * @param {string|null} address
 * @returns {Promise<string[]>}
 */
export const readRoles = async (address) => {
  const wallet = normalizeAddress(address)
  if (!wallet || !(await hasTable(TABLE))) return []

  const [rows] = await pool.execute(`SELECT role FROM ${TABLE} WHERE wallet_address = ?`, [wallet])
  return rows.map((row) => row.role).filter(isRole)
}

/**
 * Everyone holding a role, newest first, shaped like a post row so the admin tab can hand it to
 * profileFallbackFromRow as is.
 * @param {string} role
 * @returns {Promise<{migrated: boolean, holders: object[]}>}
 */
export const listRoleHolders = async (role) => {
  if (!(await hasTable(TABLE))) return { migrated: false, holders: [] }

  const [rows] = await pool.execute(
    `SELECT r.wallet_address, r.note, r.granted_by, r.granted_at, u.name, u.profileImage, u.username
       FROM ${TABLE} r
       LEFT JOIN users u ON u.wallet_address = r.wallet_address
      WHERE r.role = ?
      ORDER BY r.granted_at DESC
      LIMIT ${LIST_LIMIT}`,
    [role],
  )

  return {
    migrated: true,
    holders: rows.map((row) => ({
      wallet_address: row.wallet_address,
      display_name: row.name ?? null,
      profile_image: row.profileImage ?? null,
      username: row.username ?? null,
      note: row.note ?? null,
      grantedBy: row.granted_by,
      grantedAt: row.granted_at,
    })),
  }
}

/**
 * Grants a role. Re-granting keeps the original date and only refreshes the note.
 * @param {{wallet: string, role: string, grantedBy: string, note?: string|null}} params
 */
export const grantRole = async ({ wallet, role, grantedBy, note = null }) => {
  await pool.execute(
    `INSERT INTO ${TABLE} (wallet_address, role, granted_by, note)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE note = COALESCE(VALUES(note), note)`,
    [normalizeAddress(wallet), role, normalizeAddress(grantedBy), note],
  )
}

/**
 * Revokes a role.
 * @param {{wallet: string, role: string}} params
 * @returns {Promise<boolean>} Whether the wallet held it.
 */
export const revokeRole = async ({ wallet, role }) => {
  const [result] = await pool.execute(`DELETE FROM ${TABLE} WHERE wallet_address = ? AND role = ?`, [normalizeAddress(wallet), role])
  return result.affectedRows > 0
}

export const rolesAreMigrated = () => hasTable(TABLE)

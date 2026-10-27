/**
 * @file lib/rolesServer.js
 * @description Server-only reads and writes for admin-given roles (lib/roles.js), the Hupster
 * applications queue, and the referral ranking. A role is decoration beside a name, so every read
 * degrades to "nothing" — a database that has not run cidex/scripts/add-user-roles.sql or
 * add-hupsters.sql must never 500 a profile or the /hupsters page.
 */

import pool from '@/lib/db'
import { normalizeAddress } from '@/lib/address'
import { hasColumn, hasTable } from '@/lib/schema'
import { isRole, REAPPLY_AFTER_DAYS, ROLES } from '@/lib/roles'

const TABLE = 'user_roles'
const APPLICATIONS = 'role_applications'

// No realistic program has more members than one list can show at once.
const LIST_LIMIT = 500
const RANKING_LIMIT = 20

// A referral counts toward the ranking once the person it brought has posted — a wallet that only
// connected costs nothing to make, so on its own it proves nothing.
const ACTIVE_REFERRAL = `EXISTS (SELECT 1 FROM posts p WHERE p.wallet_address = u.wallet_address AND p.is_deleted = 0)`

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
 * Everyone holding a role, newest first, shaped like a post row so a list can hand it to
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
 * Tells a wallet it has been made a Hupster. Best effort: the grant has already happened, and a
 * notification that fails to write must not turn it into an error.
 */
const notifyGranted = async (wallet, role) => {
  try {
    await pool.execute(
      `INSERT INTO notifications (recipient_wallet_address, action_type, entity_type, title, message, action_url, email_status)
       VALUES (?, 'role_granted', 'role', ?, ?, '/hupsters', 'skipped')`,
      [wallet, `You're a ${ROLES[role].label}!`, 'Your mark is live beside your name. Share your link and post your proof on /hupsters.'],
    )
  } catch (error) {
    console.warn('[roles] grant notification failed:', error.message)
  }
}

/**
 * Grants a role, approves any application the wallet had waiting, and tells them. Re-granting
 * keeps the original date and only refreshes the note.
 * @param {{wallet: string, role: string, grantedBy: string, note?: string|null}} params
 */
export const grantRole = async ({ wallet, role, grantedBy, note = null }) => {
  const holder = normalizeAddress(wallet)
  const admin = normalizeAddress(grantedBy)

  const [result] = await pool.execute(
    `INSERT INTO ${TABLE} (wallet_address, role, granted_by, note)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE note = COALESCE(VALUES(note), note)`,
    [holder, role, admin, note],
  )

  if (await hasTable(APPLICATIONS)) {
    await pool.execute(
      `UPDATE ${APPLICATIONS} SET status = 'approved', decided_at = NOW(), decided_by = ?
        WHERE wallet_address = ? AND role = ? AND status = 'pending'`,
      [admin, holder, role],
    )
  }

  // MariaDB reports 1 for an insert and 2 for the update branch: only a first grant notifies
  if (result.affectedRows === 1) await notifyGranted(holder, role)
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

export const applicationsAreMigrated = () => hasTable(APPLICATIONS)

const toApplication = (row) => ({
  wallet_address: row.wallet_address,
  display_name: row.name ?? null,
  profile_image: row.profileImage ?? null,
  username: row.username ?? null,
  message: row.message ?? null,
  links: (() => {
    try {
      const parsed = JSON.parse(row.links ?? '[]')
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })(),
  status: row.status,
  createdAt: row.created_at,
  decidedAt: row.decided_at ?? null,
})

/**
 * The applications waiting on the team, oldest first.
 * @param {string} role
 * @returns {Promise<object[]>}
 */
export const listPendingApplications = async (role) => {
  if (!(await hasTable(APPLICATIONS))) return []

  const [rows] = await pool.execute(
    `SELECT a.*, u.name, u.profileImage, u.username
       FROM ${APPLICATIONS} a
       LEFT JOIN users u ON u.wallet_address = a.wallet_address
      WHERE a.role = ? AND a.status = 'pending'
      ORDER BY a.created_at ASC
      LIMIT ${LIST_LIMIT}`,
    [role],
  )

  return rows.map(toApplication)
}

/**
 * One wallet's application, or null.
 * @param {string} address
 * @param {string} role
 */
export const readApplication = async (address, role) => {
  const wallet = normalizeAddress(address)
  if (!wallet || !(await hasTable(APPLICATIONS))) return null

  const [rows] = await pool.execute(`SELECT * FROM ${APPLICATIONS} WHERE wallet_address = ? AND role = ? LIMIT 1`, [wallet, role])
  return rows[0] ? toApplication(rows[0]) : null
}

/**
 * Files or refreshes an application. A pending one is updated in place; a declined one reopens
 * only once REAPPLY_AFTER_DAYS have passed; an approved one means the wallet is already in.
 * @param {{wallet: string, role: string, message: string|null, links: string[]}} params
 * @returns {Promise<{ok: true}|{ok: false, reason: 'member'|'cooldown'}>}
 */
export const submitApplication = async ({ wallet, role, message, links }) => {
  const applicant = normalizeAddress(wallet)

  if ((await readRoles(applicant)).includes(role)) return { ok: false, reason: 'member' }

  const existing = await readApplication(applicant, role)
  if (existing?.status === 'declined') {
    const reopensAt = new Date(existing.decidedAt).getTime() + REAPPLY_AFTER_DAYS * 24 * 60 * 60 * 1000
    if (Date.now() < reopensAt) return { ok: false, reason: 'cooldown' }
  }

  await pool.execute(
    `INSERT INTO ${APPLICATIONS} (wallet_address, role, message, links, status)
     VALUES (?, ?, ?, ?, 'pending')
     ON DUPLICATE KEY UPDATE
       -- Assignments run left to right, so the queue date is decided before status is overwritten:
       -- an edit keeps its place in line, a reapplication joins the back
       created_at = IF(status = 'pending', created_at, NOW()),
       message = VALUES(message), links = VALUES(links), status = 'pending', decided_at = NULL, decided_by = NULL`,
    [applicant, role, message, JSON.stringify(links)],
  )

  return { ok: true }
}

/**
 * Declines a pending application.
 * @returns {Promise<boolean>} Whether there was one to decline.
 */
export const declineApplication = async ({ wallet, role, decidedBy }) => {
  if (!(await hasTable(APPLICATIONS))) return false

  const [result] = await pool.execute(
    `UPDATE ${APPLICATIONS} SET status = 'declined', decided_at = NOW(), decided_by = ?
      WHERE wallet_address = ? AND role = ? AND status = 'pending'`,
    [normalizeAddress(decidedBy), normalizeAddress(wallet), role],
  )
  return result.affectedRows > 0
}

/**
 * Hupsters ranked by the people they brought who went on to post. `recent` is the last 30 days,
 * which the ranking sorts on so a newer Hupster can reach the top; `total` is all time.
 * @param {string} role
 * @returns {Promise<{migrated: boolean, ranking: object[]}>}
 */
export const readReferralRanking = async (role) => {
  if (!(await hasTable(TABLE)) || !(await hasColumn('users', 'referred_by'))) return { migrated: false, ranking: [] }

  const [rows] = await pool.execute(
    `SELECT r.wallet_address, ref.name, ref.profileImage, ref.username,
            COUNT(*) AS joined,
            COALESCE(SUM(${ACTIVE_REFERRAL}), 0) AS total,
            COALESCE(SUM(u.created_at >= NOW() - INTERVAL 30 DAY AND ${ACTIVE_REFERRAL}), 0) AS recent
       FROM users u
       JOIN ${TABLE} r ON r.wallet_address = u.referred_by AND r.role = ?
       LEFT JOIN users ref ON ref.wallet_address = r.wallet_address
      GROUP BY r.wallet_address, ref.name, ref.profileImage, ref.username
     HAVING total > 0
      ORDER BY recent DESC, total DESC, joined DESC
      LIMIT ${RANKING_LIMIT}`,
    [role],
  )

  return {
    migrated: true,
    ranking: rows.map((row) => ({
      wallet_address: row.wallet_address,
      display_name: row.name ?? null,
      profile_image: row.profileImage ?? null,
      username: row.username ?? null,
      joined: Number(row.joined),
      total: Number(row.total),
      recent: Number(row.recent),
    })),
  }
}

/**
 * The wallet a referral code points at: an address, or the holder of a handle. Never the new
 * account itself.
 * @param {string} code What was in ?ref=.
 * @param {string} self The account being created.
 * @param {(segment: string) => Promise<string|null>} resolveHandle
 * @returns {Promise<string|null>}
 */
export const resolveReferrer = async (code, self, resolveHandle) => {
  if (typeof code !== 'string' || !code.trim()) return null
  const raw = code.trim()
  const referrer = /^0x[0-9a-fA-F]{40}$/.test(raw) ? raw.toLowerCase() : await resolveHandle(raw)
  if (!referrer || referrer === normalizeAddress(self)) return null

  // Only an account Hup already knows can be credited — a typo must not mint a phantom referrer
  const [rows] = await pool.execute('SELECT 1 FROM users WHERE wallet_address = ? LIMIT 1', [referrer])
  return rows.length ? referrer : null
}

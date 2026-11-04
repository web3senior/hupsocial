import pool from '@/lib/db'
import { isEvmAddress, normalizeAddress } from '@/lib/address'
import { hasColumn, hasTable } from '@/lib/schema'
import { achievementById } from '@/config/achievements'
import { AchievementError, validateAchievementScope } from '@/lib/achievements'

export const achievementsAreMigrated = async () => await hasTable('user_achievements') && await hasTable('user_featured_achievement')
const requireMigration = async () => {
  if (!await achievementsAreMigrated()) throw new AchievementError('Run deploy/migrations/20261105-user-achievements.sql first.', 503)
}
const HOLDER_CACHE_TTL_MS = 60_000
let holderCache = null
let walletTotalCache = null

export async function readAchievements(address) {
  const wallet = normalizeAddress(address)
  if (!isEvmAddress(wallet) || !await hasTable('user_achievements')) return []
  const [rows] = await pool.execute('SELECT achievement_id AS id, scope, awarded_at AS awardedAt, source FROM user_achievements WHERE wallet_address = ? ORDER BY awarded_at DESC', [wallet])
  return rows.filter((row) => achievementById(row.id)).map((row) => ({ ...row, awardedAt: Number(row.awardedAt) }))
}

export async function readFeaturedAchievement(address) {
  const wallet = normalizeAddress(address)
  if (!isEvmAddress(wallet) || !await achievementsAreMigrated()) return null
  const [[row]] = await pool.execute(`SELECT f.achievement_id AS id, f.scope
    FROM user_featured_achievement f JOIN user_achievements a
      ON a.wallet_address = f.wallet_address AND a.achievement_id = f.achievement_id AND a.scope = f.scope
    WHERE f.wallet_address = ?`, [wallet])
  return row && achievementById(row.id) ? row : null
}

export async function readAchievementSummary(address) {
  const [earned, featured] = await Promise.all([readAchievements(address), readFeaturedAchievement(address)])
  return { earned, featured }
}

export async function readHolderCounts() {
  if (!await hasTable('user_achievements')) return {}
  if (holderCache?.expiresAt > Date.now()) return holderCache.value
  const [rows] = await pool.execute('SELECT achievement_id AS id, COUNT(DISTINCT wallet_address) AS count FROM user_achievements GROUP BY achievement_id')
  const value = Object.fromEntries(rows.filter((row) => achievementById(row.id)).map((row) => [row.id, Number(row.count)]))
  holderCache = { value, expiresAt: Date.now() + HOLDER_CACHE_TTL_MS }
  return value
}

/** The rarity denominator. A full scan of `users`, so it is held as long as the holder counts it
 * divides — the two are only ever shown together. */
export async function readTotalWallets() {
  if (walletTotalCache?.expiresAt > Date.now()) return walletTotalCache.value
  const [[row]] = await pool.execute('SELECT COUNT(DISTINCT LOWER(wallet_address)) AS count FROM users')
  walletTotalCache = { value: Number(row.count), expiresAt: Date.now() + HOLDER_CACHE_TTL_MS }
  return walletTotalCache.value
}

export async function listAchievementHolders(id, scope = '') {
  validateAchievementScope(id, scope)
  await requireMigration()
  const username = await hasColumn('users', 'username') ? 'u.username' : 'NULL'
  const [rows] = await pool.execute(`SELECT a.wallet_address AS wallet, a.source, a.awarded_at AS awardedAt,
    a.granted_by AS grantedBy, a.note, u.name, ${username} AS username, u.profileImage AS avatar
    FROM user_achievements a LEFT JOIN users u ON u.wallet_address = a.wallet_address
    WHERE a.achievement_id = ? AND a.scope = ? ORDER BY a.awarded_at DESC LIMIT 500`, [id, scope])
  return rows.map((row) => ({ ...row, awardedAt: Number(row.awardedAt) }))
}

/** Serialize awards, revocations and feature writes across server processes. A transaction alone
 * cannot identify which INSERT IGNORE candidates won a concurrent insert. The connection-bound
 * lock makes the pre-read authoritative, and keeps revocation from racing feature selection. */
async function writeAchievements(work) {
  await requireMigration()
  const connection = await pool.getConnection()
  let locked = false
  try {
    const [[row]] = await connection.execute("SELECT GET_LOCK('hup:achievements:write', 15) AS acquired")
    locked = Number(row.acquired) === 1
    if (!locked) throw new AchievementError('Achievements are busy. Try again.', 503)
    await connection.beginTransaction()
    const result = await work(connection)
    await connection.commit()
    holderCache = null
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    try {
      if (locked) await connection.execute("SELECT RELEASE_LOCK('hup:achievements:write')")
    } finally {
      connection.release()
    }
  }
}

const batches = (items) => Array.from({ length: Math.ceil(items.length / 500) }, (_, index) => items.slice(index * 500, (index + 1) * 500))

export async function awardAchievement({ wallets, id, scope = '', source, grantedBy = null, note = null, notify = true }) {
  validateAchievementScope(id, scope)
  if (!['rule', 'admin'].includes(source)) throw new AchievementError('Invalid award source')
  const candidates = [...new Set(wallets.map(normalizeAddress).filter(isEvmAddress))].sort()
  if (!candidates.length) return []
  const inserted = await writeAchievements(async (connection) => {
    const winners = []
    for (const batch of batches(candidates)) {
      const [held] = await connection.execute(`SELECT wallet_address FROM user_achievements WHERE achievement_id = ? AND scope = ? AND wallet_address IN (${batch.map(() => '?').join(',')})`, [id, scope, ...batch])
      const existing = new Set(held.map((row) => row.wallet_address))
      const fresh = batch.filter((wallet) => !existing.has(wallet))
      if (!fresh.length) continue
      await connection.query(`INSERT IGNORE INTO user_achievements (wallet_address, achievement_id, scope, source, granted_by, note, awarded_at) VALUES ?`,
        [fresh.map((wallet) => [wallet, id, scope, source, normalizeAddress(grantedBy), note, Date.now()])])
      winners.push(...fresh)
    }
    return winners
  })
  if (notify && inserted.length) {
    const item = achievementById(id)
    for (const batch of batches(inserted)) {
      try {
        await pool.query(`INSERT INTO notifications (recipient_wallet_address, action_type, entity_type, entity_id, title, message, action_url, email_status) VALUES ?`,
          [batch.map((wallet) => [wallet, 'achievement_earned', 'achievement', id, `Achievement unlocked: ${item.name}`, item.description, `/achievements#${id}`, 'skipped'])])
      } catch (error) {
        console.error('[achievements] notification failed:', error.message)
      }
    }
  }
  return inserted
}

export async function revokeAchievement({ wallet, id, scope = '' }) {
  validateAchievementScope(id, scope)
  return writeAchievements(async (connection) => {
    const owner = normalizeAddress(wallet)
    const [[row]] = await connection.execute('SELECT source FROM user_achievements WHERE wallet_address = ? AND achievement_id = ? AND scope = ?', [owner, id, scope])
    if (!row) return false
    if (row.source !== 'admin') throw new AchievementError('Rule-earned achievements are permanent', 403)
    await connection.execute('DELETE FROM user_featured_achievement WHERE wallet_address = ? AND achievement_id = ? AND scope = ?', [owner, id, scope])
    await connection.execute("DELETE FROM user_achievements WHERE wallet_address = ? AND achievement_id = ? AND scope = ? AND source = 'admin'", [owner, id, scope])
    return true
  })
}

export async function setFeaturedAchievement({ wallet, id, scope = '', nonce }) {
  const owner = normalizeAddress(wallet)
  if (!isEvmAddress(owner)) throw new AchievementError('Invalid wallet')
  if (id !== null) validateAchievementScope(id, scope)
  else if (scope !== '') throw new AchievementError('Invalid scope')
  return writeAchievements(async (connection) => {
    if (nonce) {
      const [burn] = await connection.execute('DELETE FROM nonces WHERE nonce = ? AND wallet_address = ? AND expires_at > NOW()', [nonce, owner])
      if (!burn.affectedRows) throw new AchievementError('Invalid or expired nonce', 401)
    }
    if (id === null) {
      await connection.execute('DELETE FROM user_featured_achievement WHERE wallet_address = ?', [owner])
      return null
    }
    const [[held]] = await connection.execute('SELECT 1 FROM user_achievements WHERE wallet_address = ? AND achievement_id = ? AND scope = ?', [owner, id, scope])
    if (!held) throw new AchievementError('Earn this achievement before featuring it', 403)
    await connection.execute(`INSERT INTO user_featured_achievement (wallet_address, achievement_id, scope, updated_at) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE achievement_id = VALUES(achievement_id), scope = VALUES(scope), updated_at = VALUES(updated_at)`, [owner, id, scope, Date.now()])
    return { id, scope }
  })
}

const hasHolders = async (id, scope) => {
  const [rows] = await pool.execute('SELECT 1 FROM user_achievements WHERE achievement_id = ? AND scope = ? LIMIT 1', [id, scope])
  return rows.length > 0
}

/**
 * Runs the automatic rules and awards whoever newly qualifies.
 *
 * `notify` left unset — the scheduler — announces awards only once a rule already has holders in
 * that scope. A rule's first run is a backfill of everyone who qualified before it existed (OG
 * alone is every existing account), and announcing that would fill every inbox at once, a minute
 * after deploy. An explicit true or false, the admin's choice, always wins.
 *
 * The rules are loaded here rather than at the top of the file: they pull in the points and
 * leaderboard modules, and every profile read imports this file for readAchievementSummary.
 */
export async function runAchievementRules({ only, notify } = {}) {
  await requireMigration()
  const { RULES } = await import('@/lib/achievementRules')
  if (only && !RULES[only]) throw new AchievementError('Unknown automatic rule')
  const counts = {}
  for (const [id, rule] of Object.entries(RULES)) {
    if (only && only !== id) continue
    const winners = await rule()
    const scopes = new Set(winners.map((row) => row.scope))
    counts[id] = 0
    for (const scope of scopes) {
      const announce = typeof notify === 'boolean' ? notify : await hasHolders(id, scope)
      const inserted = await awardAchievement({ wallets: winners.filter((row) => row.scope === scope).map((row) => row.wallet), id, scope, source: 'rule', notify: announce })
      counts[id] += inserted.length
    }
  }
  return counts
}

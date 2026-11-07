import pool from '@/lib/db'
import { hasColumn } from '@/lib/schema'

// Count only wallets with a recorded Hup connection, independent of profile metadata.
export function memberFilter(since, tracksJoins) {
  if (!tracksJoins) return { where: 'WHERE 1 = 0', params: [] }
  return since
    ? { where: 'WHERE users.joined_at >= ?', params: [since] }
    : { where: 'WHERE users.joined_at IS NOT NULL', params: [] }
}

// Both EVM and Solana connect through the profile POST. Indexer cache writes never call this.
// COALESCE makes concurrent connections and reconnects preserve the first recorded join.
export async function ensureMember(address) {
  const tracksJoins = await hasColumn('users', 'joined_at')
  const [result] = await pool.execute(
    `INSERT INTO users (wallet_address, created_at, last_seen_at, lastUpdate${tracksJoins ? ', joined_at' : ''})
     VALUES (?, NOW(), NOW(), CURRENT_TIMESTAMP${tracksJoins ? ', UTC_TIMESTAMP()' : ''})
     ON DUPLICATE KEY UPDATE
       ${tracksJoins ? 'joined_at = COALESCE(joined_at, UTC_TIMESTAMP()),' : ''}
       last_seen_at = NOW()`,
    [address],
  )
  return result
}

// A verified email is already a member, even before its embedded wallet is created.
export async function ensureEmailMember(accountId, walletAddress = null) {
  if (await hasColumn('email_accounts', 'joined_at')) {
    await pool.execute(
      'UPDATE email_accounts SET joined_at = COALESCE(joined_at, UTC_TIMESTAMP()) WHERE id = ?',
      [accountId],
    )
  }
  if (walletAddress) await ensureMember(walletAddress.toLowerCase())
}

// Email identities become their wallet identity when linked, so login methods never double count.
export async function countMembers(since = null) {
  const sources = []
  if (await hasColumn('users', 'joined_at')) {
    sources.push(`SELECT CONVERT(
      CASE WHEN wallet_address REGEXP '^0x[0-9a-fA-F]{40}$' THEN LOWER(wallet_address) ELSE wallet_address END
      USING utf8mb4) COLLATE utf8mb4_bin AS identity, joined_at
      FROM users WHERE joined_at IS NOT NULL`)
  }
  if (await hasColumn('email_accounts', 'joined_at')) {
    sources.push(`SELECT CONVERT(
      COALESCE(NULLIF(LOWER(wallet_address), ''), CONCAT('email:', id))
      USING utf8mb4) COLLATE utf8mb4_bin AS identity, joined_at
      FROM email_accounts WHERE joined_at IS NOT NULL`)
  }
  if (sources.length === 0) return { total: 0, recent: 0 }
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS total, COALESCE(SUM(first_join >= ?), 0) AS recent
     FROM (
       SELECT identity, MIN(joined_at) AS first_join
       FROM (${sources.join(' UNION ALL ')}) identities
       GROUP BY identity
     ) members`,
    [since],
  )
  return { total: Number(row.total), recent: Number(row.recent) }
}

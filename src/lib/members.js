import pool from '@/lib/db'
import { hasColumn } from '@/lib/schema'

// Legacy social proof includes named/avatar profiles cached before join tracking existed.
export const MEMBER_ROW_SQL = `((name IS NOT NULL AND name <> '') OR (profileImage IS NOT NULL AND profileImage <> ''))`

export function memberFilter(since, tracksJoins) {
  if (tracksJoins) {
    return since
      ? { where: 'WHERE users.joined_at >= ?', params: [since] }
      : { where: `WHERE (users.joined_at IS NOT NULL OR ${MEMBER_ROW_SQL})`, params: [] }
  }
  return {
    where: `WHERE ${MEMBER_ROW_SQL}${since ? ' AND users.created_at >= ?' : ''}`,
    params: since ? [since] : [],
  }
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

import pool from '@/lib/db'

/**
 * Which profiles are worth pointing a crawler at.
 *
 * Loading a profile writes its users row, so most rows are addresses nobody ever signed up as.
 * The per-profile llms.txt answers 404 for those, and a sitemap that listed them would send every
 * crawler through thousands of dead ends. An account is listed once it has said something about
 * itself or published a post. Follower-only accounts still serve a llms.txt, but as the LSP26
 * indexer fills the follow graph they outnumber real profiles fifty to one, and an index made of
 * nameless addresses reads as thin content to every crawler that matters.
 */

/* Each listed profile contributes two URLs (page + llms.txt); the protocol caps a file at 50,000. */
export const PROFILES_PER_SITEMAP = 25_000

const HAS_IDENTITY = `(
  (u.name IS NOT NULL AND u.name <> '')
  OR (u.description IS NOT NULL AND u.description <> '')
  OR (u.tags IS NOT NULL AND u.tags NOT IN ('', '[]'))
  OR (u.links IS NOT NULL AND u.links NOT IN ('', '[]'))
)`

/* posts.wallet_address shares users' collation; follows does not, and a correlated comparison
   against it would abandon the index and scan the whole graph once per user. */
const HAS_POSTS = `EXISTS (SELECT 1 FROM posts p WHERE p.wallet_address = u.wallet_address AND p.is_deleted = 0)`

const LISTABLE = `${HAS_IDENTITY} OR ${HAS_POSTS}`

/** How many profiles the sitemaps cover; 0 when the database is unreachable. */
export async function countListableProfiles() {
  try {
    const [[row]] = await pool.execute(`SELECT COUNT(*) AS total FROM users u WHERE ${LISTABLE}`)
    return Number(row?.total ?? 0)
  } catch (error) {
    console.error('[profile sitemap] could not count profiles:', error.message)
    return 0
  }
}

/** One sitemap's worth of profiles, in a stable order so chunk boundaries hold between builds. */
export async function listProfiles(chunk) {
  const offset = Math.max(0, Number(chunk) || 0) * PROFILES_PER_SITEMAP
  try {
    const [rows] = await pool.execute(
      `SELECT u.wallet_address, u.lastUpdate
       FROM users u
       WHERE ${LISTABLE}
       ORDER BY u.wallet_address ASC
       LIMIT ${PROFILES_PER_SITEMAP} OFFSET ${offset}`,
    )
    return rows
  } catch (error) {
    console.error('[profile sitemap] could not list profiles:', error.message)
    return []
  }
}

export function sitemapChunkCount(total) {
  return Math.max(1, Math.ceil(total / PROFILES_PER_SITEMAP))
}

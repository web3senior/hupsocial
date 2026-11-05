import pool from '@/lib/db'
import { hasColumn, hasTable } from '@/lib/schema'
import { ACHIEVEMENTS, achievementById, OG_CUTOFF } from '@/config/achievements'
import { POINTS_SEASONS } from '@/config/points'
import { getSeasonStandings } from '@/lib/points'
import { readAchievementCatalog } from '@/lib/achievementCatalog'
import { readBadStanding } from '@/lib/achievementStanding'

const ruleSetting = async (id) => (await readAchievementCatalog()).find((item) => item.id === id)

const collate = (column) => `CONVERT(${column} USING utf8mb4) COLLATE utf8mb4_general_ci`

async function newWinners(id, query, params = []) {
  const [rows] = await pool.execute(`
    SELECT DISTINCT eligible.wallet, '' AS scope FROM (${query}) eligible
    WHERE eligible.wallet IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM user_achievements a
      WHERE a.wallet_address = ${collate('eligible.wallet')} AND a.achievement_id = ? AND a.scope = ''
    )`, [...params, id])
  // People and AI agents qualify through the same activity and identity requirements.
  return excludeBadStanding(rows)
}

/** No automatic achievement for a wallet the community has blocked (lib/achievementStanding.js). */
async function excludeBadStanding(candidates) {
  if (!candidates.length) return candidates
  const blocked = await readBadStanding()
  return blocked.size ? candidates.filter(({ wallet }) => !blocked.has(wallet.toLowerCase())) : candidates
}

/* A rule over a table some databases have not migrated yet reads as nobody qualifying, rather than
   failing the whole run (runAchievementRules evaluates every rule back to back). */
const whenTable = (table, rule) => async () => ((await hasTable(table)) ? rule() : [])

const tipsRule = (id, threshold) => () => newWinners(id,
  'SELECT LOWER(tipper) AS wallet FROM tips GROUP BY LOWER(tipper) HAVING COUNT(*) >= ?', [threshold])

/* Wallets followed by at least `?` qualified followers — followers who have posted or liked, the
   leaderboard's own definition (lib/leaderboard.js), so follow farms count for nothing. */
const FOLLOWED_BY_QUALIFIED = `
  SELECT LOWER(f.followed_address) AS wallet FROM follows f
  JOIN (
    SELECT ${collate('wallet_address')} AS wallet FROM posts WHERE wallet_address IS NOT NULL
    UNION
    SELECT ${collate('liker_address')} AS wallet FROM post_likes WHERE liker_address IS NOT NULL
  ) qualified ON qualified.wallet = ${collate('f.follower_address')}
  WHERE f.is_following = 1
  GROUP BY LOWER(f.followed_address) HAVING COUNT(DISTINCT f.follower_address) >= ?`

/** Trusted: standing over time and people who chose to follow. Good standing with the community
 * is checked for every rule in newWinners, so it needs no clause of its own here. */
async function trustedRule() {
  const { minDays, minFollowers } = await ruleSetting('trusted')
  return newWinners('trusted', `
    SELECT veteran.wallet FROM (
      SELECT LOWER(wallet_address) AS wallet FROM posts WHERE is_repost IS NULL
      GROUP BY LOWER(wallet_address) HAVING MIN(created_at) <= NOW() - INTERVAL ? DAY
    ) veteran
    JOIN (${FOLLOWED_BY_QUALIFIED}) followed ON ${collate('followed.wallet')} = ${collate('veteran.wallet')}`, [minDays, minFollowers])
}

/** OG: real part taken before the cutoff — posts, comments on posts, and replies to comments.
 * A comment whose post is gone counts as a comment, since that is the most it can prove. */
async function ogRule() {
  const { minPosts, minComments, minReplies } = achievementById('og')
  return newWinners('og', `
    SELECT LOWER(c.wallet_address) AS wallet FROM posts c
    LEFT JOIN posts parent ON parent.id = c.is_comment AND parent.network_id = c.network_id
    WHERE c.is_deleted = 0 AND c.is_repost IS NULL AND c.created_at < ?
    GROUP BY LOWER(c.wallet_address)
    HAVING SUM(c.is_comment IS NULL) >= ?
      AND SUM(c.is_comment IS NOT NULL AND (parent.id IS NULL OR parent.is_comment IS NULL)) >= ?
      AND SUM(parent.is_comment IS NOT NULL) >= ?`, [OG_CUTOFF, minPosts, minComments, minReplies])
}

export const RULES = {
  // Read off the posts themselves, not the users row: that row can be written after a wallet's
  // first post, and would cost an early poster OG.
  og: ogRule,
  'first-post': () => newWinners('first-post', 'SELECT LOWER(wallet_address) AS wallet FROM posts WHERE is_comment IS NULL AND is_repost IS NULL'),
  'first-tip': tipsRule('first-tip', 1),
  generous: async () => tipsRule('generous', (await ruleSetting('generous')).threshold)(),
  'rising-voice': async () => newWinners('rising-voice', FOLLOWED_BY_QUALIFIED, [(await ruleSetting('rising-voice')).threshold]),
  'self-sovereign': async () => ((await hasColumn('users', 'is_universal_profile'))
    ? newWinners('self-sovereign', 'SELECT LOWER(wallet_address) AS wallet FROM users WHERE is_universal_profile = 1')
    : []),
  // Paid, not complimentary: a Premium the team gave away supports nothing.
  supporter: whenTable('premium_subscriptions', () => newWinners('supporter',
    'SELECT LOWER(account) AS wallet FROM premium_subscriptions WHERE COALESCE(complimentary, 0) = 0 AND purchase_count > 0')),
  // Different people, counted once each; tipping yourself proves nothing.
  'community-backed': async () => newWinners('community-backed', `
    SELECT LOWER(creator) AS wallet FROM tips
    WHERE creator IS NOT NULL AND tipper IS NOT NULL AND LOWER(tipper) <> LOWER(creator)
    GROUP BY LOWER(creator) HAVING COUNT(DISTINCT LOWER(tipper)) >= ?`, [(await ruleSetting('community-backed')).threshold]),
  trusted: trustedRule,
  'agent-builder': whenTable('hosted_agents', () => newWinners('agent-builder',
    'SELECT LOWER(owner_address) AS wallet FROM hosted_agents WHERE owner_address IS NOT NULL')),
  // agent_identities only holds links the Identity Registry confirmed (lib/agentIdentities.js).
  'registered-agent': whenTable('agent_identities', () => newWinners('registered-agent',
    'SELECT LOWER(wallet_address) AS wallet FROM agent_identities')),
  'season-top-10': async () => {
    const winners = []
    for (const season of POINTS_SEASONS) {
      if (!season.endsAt || Date.parse(`${season.endsAt.replace(' ', 'T')}Z`) >= Date.now()) continue
      const scope = String(season.id)
      const [held] = await pool.execute('SELECT wallet_address FROM user_achievements WHERE achievement_id = ? AND scope = ?', ['season-top-10', scope])
      const existing = new Set(held.map((row) => row.wallet_address))
      const { rows } = await getSeasonStandings(season)
      for (const row of rows) {
        const wallet = row.wallet_address.toLowerCase()
        if (row.rank !== null && row.rank <= 10 && !existing.has(wallet)) winners.push({ wallet, scope })
      }
    }
    return excludeBadStanding(winners)
  },
}

// Fail early if a future catalog entry ships without its automatic rule.
for (const item of ACHIEVEMENTS) {
  if (item.kind === 'auto' && !RULES[item.id]) throw new Error(`Missing achievement rule: ${item.id}`)
}

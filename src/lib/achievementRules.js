import pool from '@/lib/db'
import { hasColumn, hasTable } from '@/lib/schema'
import { hasAiAgentTag } from '@/lib/agentProfile'
import { ACHIEVEMENTS, achievementById, OG_CUTOFF } from '@/config/achievements'
import { POINTS_SEASONS } from '@/config/points'
import { getSeasonStandings } from '@/lib/points'

const collate = (column) => `CONVERT(${column} USING utf8mb4) COLLATE utf8mb4_general_ci`

/* Every rule filters through the agent list, and building it scans every tagged user. One run
   evaluates all the rules back to back, so the list is built once and shared for a short while
   instead of once per rule. */
const AGENT_LIST_TTL_MS = 60_000
let agentList = null

async function readAgentWallets() {
  if (agentList?.expiresAt > Date.now()) return agentList.wallets
  const wallets = new Set()
  if (await hasTable('hosted_agents')) {
    const [rows] = await pool.execute('SELECT LOWER(agent_address) AS wallet FROM hosted_agents')
    for (const row of rows) wallets.add(row.wallet)
  }
  if (await hasColumn('users', 'tags')) {
    const [rows] = await pool.execute('SELECT LOWER(wallet_address) AS wallet, tags FROM users WHERE tags IS NOT NULL')
    for (const row of rows) if (hasAiAgentTag(row)) wallets.add(row.wallet)
  }
  agentList = { wallets, expiresAt: Date.now() + AGENT_LIST_TTL_MS }
  return wallets
}

/** Hosted wallets and explicitly tagged bots are excluded, including mixed-case addresses. */
export async function excludeAchievementAgents(candidates) {
  if (!candidates.length) return candidates
  const excluded = await readAgentWallets()
  return candidates.filter(({ wallet }) => !excluded.has(wallet.toLowerCase()))
}

async function newWinners(id, query, params = []) {
  const [rows] = await pool.execute(`
    SELECT DISTINCT eligible.wallet, '' AS scope FROM (${query}) eligible
    WHERE eligible.wallet IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM user_achievements a
      WHERE a.wallet_address = ${collate('eligible.wallet')} AND a.achievement_id = ? AND a.scope = ''
    )`, [...params, id])
  return excludeAchievementAgents(rows)
}

const tipsRule = (id, threshold) => () => newWinners(id,
  'SELECT LOWER(tipper) AS wallet FROM tips GROUP BY LOWER(tipper) HAVING COUNT(*) >= ?', [threshold])

export const RULES = {
  // A post or reply before the cutoff, never a repost. Read off the posts themselves, not the users
  // row: that row can be written after a wallet's first post, and would cost an early poster OG.
  og: () => newWinners('og', 'SELECT LOWER(wallet_address) AS wallet FROM posts WHERE is_repost IS NULL AND created_at < ?', [OG_CUTOFF]),
  'first-post': () => newWinners('first-post', 'SELECT LOWER(wallet_address) AS wallet FROM posts WHERE is_comment IS NULL AND is_repost IS NULL'),
  'first-tip': tipsRule('first-tip', 1),
  generous: tipsRule('generous', achievementById('generous').threshold),
  'rising-voice': () => newWinners('rising-voice', `
    SELECT LOWER(f.followed_address) AS wallet FROM follows f
    JOIN (
      SELECT ${collate('wallet_address')} AS wallet FROM posts WHERE wallet_address IS NOT NULL
      UNION
      SELECT ${collate('liker_address')} AS wallet FROM post_likes WHERE liker_address IS NOT NULL
    ) qualified ON qualified.wallet = ${collate('f.follower_address')}
    WHERE f.is_following = 1
    GROUP BY LOWER(f.followed_address) HAVING COUNT(DISTINCT f.follower_address) >= ?`,
  [achievementById('rising-voice').threshold]),
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
    return excludeAchievementAgents(winners)
  },
}

// Fail early if a future catalog entry ships without its automatic rule.
for (const item of ACHIEVEMENTS) {
  if (item.kind === 'auto' && !RULES[item.id]) throw new Error(`Missing achievement rule: ${item.id}`)
}

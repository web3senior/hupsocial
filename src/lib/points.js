/**
 * @file lib/points.js
 * @description Hup points: one season's standings, the list the $HUP airdrop is cut from. A wallet's
 * points are its leaderboard score over the season (lib/leaderboard.js) plus the coins it launched
 * in the same window (config/points.js POINTS_RULES), plus bonuses for rare achievements
 * (ACHIEVEMENT_BONUSES), and it ranks only once its Hup profile is old enough. Cached per season,
 * like the leaderboard. Server-only.
 */

import { getLeaderboardSnapshot, serializeLeader } from '@/lib/leaderboard'
import pool from '@/lib/db'
import { hasTable } from '@/lib/schema'
import { ACHIEVEMENT_BONUSES, ACHIEVEMENT_GRANTED_CAP, POINTS_RULES } from '@/config/points'

const POINTS_CACHE_TTL_MS = 60_000
const pointsCache = new Map()

/** An SQL datetime (UTC) as epoch milliseconds. */
const sqlTime = (value) => Date.parse(`${String(value).replace(' ', 'T')}Z`)

/**
 * The season's standings: every wallet with points, eligible ones ranked first by points, the rest
 * after them unranked. Recomputed at most once per POINTS_CACHE_TTL_MS.
 *
 * With `networkId`, the same season read on one network only: the social points earned there,
 * ranked among the wallets active there. Launches go out to several chains at once and achievement
 * bonuses belong to no chain, so neither is counted in a network's view. The airdrop is always cut
 * from the all-network standings.
 */
export async function getSeasonStandings(season, { networkId = null } = {}) {
  const key = `${season.id}:${networkId ?? 'all'}`
  const cached = pointsCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const value = await computeSeasonStandings(season, networkId)
  pointsCache.set(key, { value, expiresAt: Date.now() + POINTS_CACHE_TTL_MS })
  return value
}

async function computeSeasonStandings(season, networkId) {
  const since = season.startsAt
  const until = season.endsAt
  const scoped = networkId !== null
  const [social, launchpad, held] = await Promise.all([
    getLeaderboardSnapshot({
      period: 'all',
      sort: 'score',
      networkId,
      since,
      until,
      scope: `points-season-${season.id}${scoped ? `-network-${networkId}` : ''}`,
    }),
    scoped ? [] : readLaunchpadActivity(since, until),
    readHeldAchievements(),
  ])

  const wallets = new Map()
  const entry = (wallet) => {
    const key = wallet.toLowerCase()
    if (!wallets.has(key)) wallets.set(key, { wallet_address: wallet, leader: null, launches: 0 })
    return wallets.get(key)
  }
  for (const row of social.rows) entry(row.wallet_address).leader = row
  for (const row of launchpad) entry(row.wallet).launches = row.launches

  const now = Date.now()
  const minAge = POINTS_RULES.minAccountAgeDays * 24 * 3600 * 1000
  const rows = [...wallets.values()].map((item) => {
    const leader = item.leader ? serializeLeader(item.leader, null) : null
    const socialPoints = Math.round((leader?.score ?? 0) * POINTS_RULES.socialWeight)
    const launchpadPoints = item.launches * POINTS_RULES.perLaunch
    const mine = held.get(item.wallet_address.toLowerCase()) ?? []
    // A bonus only tops up a wallet that scored this season, and belongs to no one network
    const bonuses = !scoped && socialPoints + launchpadPoints > 0 ? achievementBonuses(mine, season) : []
    const achievementPoints = bonuses.reduce((sum, bonus) => sum + bonus.points, 0)
    const joinedAt = item.leader?.created_at ? new Date(item.leader.created_at).getTime() : null
    const eligible = joinedAt !== null && now - joinedAt >= minAge
    return {
      wallet_address: item.wallet_address,
      display_name: leader?.display_name ?? `${item.wallet_address.slice(0, 6)}...${item.wallet_address.slice(-4)}`,
      username: leader?.username ?? null,
      profile_image: leader?.profile_image ?? null,
      points: socialPoints + launchpadPoints + achievementPoints,
      social_points: socialPoints,
      launchpad_points: launchpadPoints,
      achievement_points: achievementPoints,
      // Every achievement held (for the row's marks), and which of them paid a bonus this season
      achievements: [...new Set(mine.map((row) => row.id))],
      achievement_bonuses: bonuses,
      // The season's social activity behind the score, for the row's activity line
      root_posts: leader?.root_posts ?? 0,
      comments_made: leader?.comments_made ?? 0,
      likes_received: leader?.likes_received ?? 0,
      reposts_made: leader?.reposts_made ?? 0,
      views_received: leader?.views_received ?? 0,
      tips_received: leader?.tips_received ?? 0,
      tx_count: leader?.tx_count ?? 0,
      follower_count: leader?.follower_count ?? 0,
      launches: item.launches,
      eligible,
      // Why a wallet is not ranked yet: no profile, or one too new
      eligible_from: joinedAt === null ? null : new Date(joinedAt + minAge).toISOString(),
    }
  })

  rows.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.points - a.points)
  let rank = 0
  for (const row of rows) row.rank = row.eligible && row.points > 0 ? ++rank : null

  const ranked = rows.filter((row) => row.rank !== null)
  return {
    rows: rows.filter((row) => row.points > 0),
    totals: {
      participants: ranked.length,
      points: ranked.reduce((sum, row) => sum + row.points, 0),
    },
    computedAt: new Date(now).toISOString(),
    endsAt: until ? new Date(sqlTime(until)).toISOString() : null,
  }
}

/** Each wallet's launches in the window. Trades are not read: trading earns no points. */
async function readLaunchpadActivity(since, until) {
  // Read straight from Hup's pool: points never need the launchpad's code, only its table, and a
  // database without the launchpad yet simply has no launches to count
  if (!(await hasTable('launchpad_launches'))) return []
  const window = until ? 'created_at >= ? AND created_at < ?' : 'created_at >= ?'
  const [launches] = await pool.query(
    `SELECT LOWER(creator) AS wallet, COUNT(*) AS n FROM launchpad_launches WHERE ${window} GROUP BY LOWER(creator)`,
    until ? [since, until] : [since]
  )
  return launches.map((row) => ({ wallet: row.wallet, launches: Number(row.n) }))
}

/** Every wallet's stored achievements, by lowercase wallet; empty until the achievements migration runs. */
async function readHeldAchievements() {
  if (!(await hasTable('user_achievements'))) return new Map()
  const [rows] = await pool.query('SELECT LOWER(wallet_address) AS wallet, achievement_id, scope, awarded_at FROM user_achievements')
  const byWallet = new Map()
  for (const row of rows) {
    if (!byWallet.has(row.wallet)) byWallet.set(row.wallet, [])
    byWallet.get(row.wallet).push({ id: row.achievement_id, scope: row.scope, awardedAt: Number(row.awarded_at) })
  }
  return byWallet
}

/**
 * The achievement bonuses one wallet earns in a season (config/points.js ACHIEVEMENT_BONUSES):
 * `[{ id, scope, points }]`, granted ones trimmed to ACHIEVEMENT_GRANTED_CAP together.
 */
function achievementBonuses(held, season) {
  const from = sqlTime(season.startsAt)
  const to = season.endsAt ? sqlTime(season.endsAt) : Infinity
  let grantedLeft = ACHIEVEMENT_GRANTED_CAP
  const bonuses = []
  for (const row of held) {
    const rule = ACHIEVEMENT_BONUSES[row.id]
    if (!rule) continue
    const counts = rule.seasons
      ? rule.seasons.includes(season.id)
      : rule.nextSeason
        ? Number(row.scope) + 1 === season.id
        : row.awardedAt >= from && row.awardedAt < to
    if (!counts) continue
    let points = rule.points
    if (rule.granted) {
      points = Math.min(points, grantedLeft)
      grantedLeft -= points
    }
    if (points > 0) bonuses.push({ id: row.id, scope: row.scope, points })
  }
  return bonuses
}

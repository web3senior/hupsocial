/**
 * @file config/points.js
 * @description Hup points seasons: what counts toward the $HUP airdrop, and over which window.
 * A season scores everything a wallet does on Hup between its start and its end; an open season
 * (no end) runs until the end is announced. Changing a weight here rescores the season live, so
 * settle the rules before a season starts and publish them with it.
 */

export const POINTS_SEASONS = [
  {
    id: 1,
    name: 'Season 1',
    // UTC, as SQL datetimes, compared against the activity tables' own timestamps
    startsAt: '2026-11-05 00:00:00',
    // Open until the token launch: set it to the snapshot moment, announced 2 weeks ahead, so the
    // airdrop list is final before launch and nobody can farm a surprise cutoff
    endsAt: null,
  },
]

export const POINTS_RULES = {
  // Social activity scores as the leaderboard's total score over the season (lib/leaderboard.js)
  socialWeight: 1,
  // A coin launched counts like a post. Trading earns nothing: points must never be a reason to put
  // money at risk, and a launch needs no buy
  perLaunch: 10,
  // A wallet ranks only once its Hup profile is this old: fresh wallets farm, old ones rarely do
  minAccountAgeDays: 7,
}

/**
 * Achievement bonuses (config/achievements.js ids), added to a wallet's season points. Only rare and
 * rarer ones count: the common ones reward what points already score. A bonus lands in the season
 * the achievement was earned (`awarded_at` inside it), except:
 *   - `seasons`: counts only in these seasons, whenever it was earned (OG rewards being early once);
 *   - `nextSeason`: a per-season achievement pays in the season after the one it names.
 * Granted achievements together pay at most `grantedCap` a season, so an admin grant never decides
 * the airdrop. A bonus only tops up a wallet that scored this season: an idle holder earns nothing.
 */
export const ACHIEVEMENT_BONUSES = {
  og: { points: 500, seasons: [1] },
  'season-top-10': { points: 250, nextSeason: true },
  'rising-voice': { points: 100 },
  generous: { points: 100 },
  'early-tester': { points: 100, granted: true },
  'bug-hunter': { points: 100, granted: true },
}

export const ACHIEVEMENT_GRANTED_CAP = 100

/** An achievement's airdrop bonus in words, or null when it pays none. */
export function achievementBonusLabel(id) {
  const rule = ACHIEVEMENT_BONUSES[id]
  if (!rule) return null
  const points = `+${rule.points} airdrop points`
  if (rule.seasons) return `${points} in Season ${rule.seasons.join(', ')}`
  if (rule.nextSeason) return `${points} the season after`
  return points
}

/** The season running now, else the last one that ran. */
export function currentSeason(now = Date.now()) {
  const started = POINTS_SEASONS.filter((season) => Date.parse(`${season.startsAt.replace(' ', 'T')}Z`) <= now)
  return started.at(-1) ?? POINTS_SEASONS[0]
}

export const seasonById = (id) => POINTS_SEASONS.find((season) => season.id === Number(id)) ?? null

/**
 * @file lib/hupiTools.js
 * @description The read-only tools Hupi, the premium assistant, can call. Server-only.
 *
 * Every tool answers from data the app already shows somewhere — notifications, the leaderboard
 * snapshot, the trending ranking — so Hupi never knows more than the asking wallet could see by
 * browsing. The wallet is passed in by the route from a verified chat token; no tool takes an
 * address from the model, so a prompt cannot ask for someone else's inbox.
 */

import pool from '@/lib/db'
import { getLeaderboardSnapshot, getSinceDate, normalizePeriod, serializeLeader, SORTS } from '@/lib/leaderboard'
import { getPostPermalink } from '@/lib/postMarkdown'
import { CASHTAG_PATTERN } from '@/lib/markdown'
import { profilePath } from '@/lib/username'
import { readPostRow } from '@/lib/postRows'
import { readPremium } from '@/lib/premiumServer'
import { hasColumn } from '@/lib/schema'
import { categoryLabel, formatTokenAmount, taskHref } from '@/lib/task'

// Windows are interpolated into SQL after clamping, the same way the trending query does, so
// they must stay integers from this file's own bounds
const MAX_WINDOW_HOURS = 24 * 7
const DEFAULT_WINDOW_HOURS = 24

const CATCHUP_BUSIEST_POSTS = 3
const LEADERBOARD_MAX = 10
const TRENDING_POSTS = 8
const TRENDING_COMMENT_WEIGHT = 3
const CASHTAG_SCAN_LIMIT = 500
const CASHTAG_TOP = 8
const EXCERPT_CHARS = 280
const CARD_EXCERPT_CHARS = 140
const PAGE_POST_CHARS = 2000
const PERFORMANCE_DEFAULT_DAYS = 7
const PERFORMANCE_SCAN_POSTS = 50
const PERFORMANCE_TOP = 3
// "Who to follow" draws from the leaderboard's first screen, as the home feed's does
const WHO_TO_FOLLOW_POOL = 20
const WHO_TO_FOLLOW_MAX = 5
const CLOSING_DEFAULT_DAYS = 3
const CLOSING_MAX_DAYS = 14
const CLOSING_PER_KIND = 5
const MAX_FOLLOW_UPS = 3
// Profile text is the account's own words: bounded, since it rides into the prompt
const PROFILE_NAME_CHARS = 60
const PROFILE_ABOUT_CHARS = 400

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

const clampHours = (value) => {
  const hours = Math.round(Number(value))
  return Number.isFinite(hours) && hours > 0 ? Math.min(hours, MAX_WINDOW_HOURS) : DEFAULT_WINDOW_HOURS
}

const shortWallet = (wallet = '') => (wallet.length > 12 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet)

/* "in 3 hours", "tomorrow": the model copies it as is, so it never does date maths or prints a
   timestamp */
const fromNow = (unixSeconds) => {
  const seconds = Number(unixSeconds) - Date.now() / 1000
  const span = Math.abs(seconds)
  if (span < 3600) return RELATIVE.format(Math.round(seconds / 60), 'minute')
  if (span < 86400) return RELATIVE.format(Math.round(seconds / 3600), 'hour')
  return RELATIVE.format(Math.round(seconds / 86400), 'day')
}

/* How long ago, in the unit a person would say: "3 months ago", "last year" */
const sinceWhen = (unixSeconds) => {
  const days = (Date.now() / 1000 - Number(unixSeconds)) / 86400
  if (days < 45) return fromNow(unixSeconds)
  if (days < 365) return RELATIVE.format(-Math.round(days / 30), 'month')
  return RELATIVE.format(-Math.round(days / 365), 'year')
}

/* Post content is the IPFS JSON as stored; the text lives in its first text element */
const postText = (content, limit = EXCERPT_CHARS) => {
  let parsed = content
  try {
    parsed = JSON.parse(content)
  } catch {
    /* a bare string body */
  }
  if (parsed?.encrypted) return ''
  const text = Array.isArray(parsed?.elements)
    ? parsed.elements.find((element) => element?.type === 'text')?.data?.text || ''
    : typeof parsed === 'string'
      ? parsed
      : ''
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

// --- Cards ---
// What the panel draws under a reply for each post or profile it links to. Cards ride beside a
// tool's data, never inside what the model reads; `link` is the join key, so it is always the
// same path the model is handed for that entity.

const postCard = (row, stats) => ({
  kind: 'post',
  link: getPostPermalink(row),
  title: row.name || shortWallet(row.wallet_address),
  image: row.profile_image || null,
  text: postText(row.content, CARD_EXCERPT_CHARS),
  stats,
})

const profileCard = (leader, subtitle) => ({
  kind: 'profile',
  link: profilePath(leader.wallet_address, leader.username),
  title: leader.display_name,
  image: leader.profile_image || null,
  subtitle,
})

// What each notification type reads as in a count. A type not listed here (cidex adds them over
// time) still counts, under its own name with the underscores spaced out.
const ACTIVITY_LABELS = {
  post_received_like: 'likes',
  post_received_comment: 'comments',
  post_received_repost: 'reposts',
  post_received_quote: 'quotes',
  post_mentioned: 'mentions',
  post_received_tip: 'tips',
  user_received_follow: 'new followers',
  nft_sold: 'NFT sales',
  nft_offer_received: 'NFT offers',
  market_received_bet: 'prediction bets',
  sell_received_purchase: 'purchases',
  task_paid: 'task payouts',
}

const activityLabel = (type) => ACTIVITY_LABELS[type] || String(type).replaceAll('_', ' ')

// Only what other people did: the indexer also writes rows for the wallet's own actions
const OTHERS_ROW = 'actor_wallet_address IS NOT NULL AND NOT (actor_wallet_address = recipient_wallet_address)'

// --- Tools ---

/* Counts, not a feed: "8 people liked your posts" is the answer people want, and a list of single
   events is what made the model recite rows. Grouped in SQL so a busy wallet is counted whole. */
const getMyCatchup = async ({ hours }, { wallet }) => {
  const window = clampHours(hours)
  const scope = `recipient_wallet_address = ? AND ${OTHERS_ROW} AND created_at >= NOW() - INTERVAL ${window} HOUR`

  const [[kinds], [posts], [[unread]]] = await Promise.all([
    pool.execute(
      `SELECT action_type, COUNT(*) AS total, COUNT(DISTINCT actor_wallet_address) AS people
         FROM notifications
        WHERE ${scope}
        GROUP BY action_type
        ORDER BY total DESC`,
      [wallet],
    ),
    pool.execute(
      `SELECT action_url, COUNT(*) AS total, COUNT(DISTINCT actor_wallet_address) AS people
         FROM notifications
        WHERE ${scope} AND action_url IS NOT NULL AND action_type LIKE 'post\\_%'
        GROUP BY action_url
        ORDER BY total DESC
        LIMIT ${CATCHUP_BUSIEST_POSTS}`,
      [wallet],
    ),
    pool.execute(`SELECT COUNT(*) AS total FROM notifications WHERE recipient_wallet_address = ? AND ${OTHERS_ROW} AND is_read = 0`, [
      wallet,
    ]),
  ])

  return {
    window_hours: window,
    activity: kinds.map((row) => ({ kind: activityLabel(row.action_type), count: Number(row.total), people: Number(row.people) })),
    busiest_posts: posts.map((row) => ({ link: row.action_url, interactions: Number(row.total), people: Number(row.people) })),
    unread_notifications: Number(unread?.total || 0),
    see_all: '/notifications',
  }
}

const getPlatformStats = async () => {
  const { stats, stats_24h: day } = await getLeaderboardSnapshot({ period: 'all', sort: 'score', networkId: null, since: null })

  return {
    note: 'last_24h counts are a rolling 24 hours, not since midnight',
    totals: stats,
    last_24h: day,
  }
}

const getLeaderboard = async ({ sort, period, limit }) => {
  const scope = normalizePeriod(period)
  const order = Object.hasOwn(SORTS, sort) ? sort : 'score'
  const count = Math.min(Math.max(Math.round(Number(limit)) || 5, 1), LEADERBOARD_MAX)

  const { rows } = await getLeaderboardSnapshot({ period: scope, sort: order, networkId: null, since: getSinceDate(scope) })
  const leaders = rows.slice(0, count).map((row, index) => serializeLeader(row, index + 1))

  return {
    period: scope,
    sort: order,
    leaders: leaders.map((leader) => ({
      rank: leader.rank,
      name: leader.display_name,
      profile: profilePath(leader.wallet_address, leader.username),
      score: leader.score,
      posts: leader.total_posts,
      likes_received: leader.likes_received,
      followers: leader.follower_count,
      tips_received: leader.tips_received,
    })),
    cards: leaders.map((leader) => profileCard(leader, `#${leader.rank} · ${COMPACT.format(leader.follower_count)} followers`)),
  }
}

const getTrending = async ({ hours }) => {
  const window = clampHours(hours)

  /* The trending feed's velocity score, narrowed further: community posts stay out entirely,
     since Hupi answers in a panel that cannot apply the per-viewer membership rule */
  const [posts] = await pool.execute(
    `SELECT p.id, p.network_id, p.content, p.wallet_address, u.name, u.profileImage AS profile_image, agg.likes, agg.comments
       FROM (
         SELECT post_id, network_id, SUM(is_like) AS likes, SUM(is_reply) AS comments
           FROM (
             SELECT post_id, network_id, 1 AS is_like, 0 AS is_reply
               FROM post_likes
              WHERE is_active = 1 AND liked_at >= NOW() - INTERVAL ${window} HOUR
             UNION ALL
             SELECT is_comment, network_id, 0, 1
               FROM posts
              WHERE is_comment IS NOT NULL AND is_deleted = 0 AND created_at >= NOW() - INTERVAL ${window} HOUR
           ) events
          GROUP BY post_id, network_id
       ) agg
       JOIN posts p ON p.id = agg.post_id AND p.network_id = agg.network_id
       LEFT JOIN users u ON p.wallet_address = u.wallet_address
      WHERE p.is_comment IS NULL AND p.is_deleted = 0 AND p.community_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM user_reports ur
           WHERE ur.post_id = p.id AND ur.network_id = p.network_id AND ur.status = 'actioned'
        )
      ORDER BY (agg.likes + agg.comments * ${TRENDING_COMMENT_WEIGHT}) DESC, p.created_at DESC
      LIMIT ${TRENDING_POSTS}`,
  )

  const [recent] = await pool.execute(
    `SELECT content FROM posts
      WHERE is_comment IS NULL AND is_deleted = 0 AND community_id IS NULL
        AND created_at >= NOW() - INTERVAL ${window} HOUR
      ORDER BY created_at DESC
      LIMIT ${CASHTAG_SCAN_LIMIT}`,
  )

  const tags = new Map()
  for (const row of recent) {
    // Counted once per post, so one post repeating a ticker cannot carry it
    const seen = new Set([...postText(row.content).matchAll(CASHTAG_PATTERN)].map((match) => match[2].toUpperCase()))
    for (const symbol of seen) tags.set(symbol, (tags.get(symbol) || 0) + 1)
  }

  return {
    window_hours: window,
    posts: posts.map((row) => ({
      author: row.name || shortWallet(row.wallet_address),
      author_profile: profilePath(row.wallet_address, null),
      excerpt: postText(row.content),
      likes: Number(row.likes),
      comments: Number(row.comments),
      link: getPostPermalink(row),
    })),
    cashtags: [...tags.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, CASHTAG_TOP)
      .map(([symbol, mentions]) => ({ symbol: `$${symbol}`, posts: mentions })),
    cards: posts.map((row) => postCard(row, { likes: Number(row.likes), comments: Number(row.comments) })),
  }
}

/* Engagement that landed in the window, on the wallet's recent posts: a post from last month
   that took off this week counts, which is what "how did my posts do" means */
const getMyPostPerformance = async ({ days }, { wallet }) => {
  const window = clampHours(Number(days) * 24 || PERFORMANCE_DEFAULT_DAYS * 24)
  const since = `NOW() - INTERVAL ${window} HOUR`

  const [rows] = await pool.execute(
    `SELECT p.id, p.network_id, p.content, p.wallet_address, u.name, u.profileImage AS profile_image,
            p.created_at >= ${since} AS is_new,
            (SELECT COUNT(*) FROM post_likes pl
              WHERE pl.post_id = p.id AND pl.network_id = p.network_id AND pl.is_active = 1 AND pl.liked_at >= ${since}) AS likes,
            (SELECT COUNT(*) FROM posts c
              WHERE c.is_comment = p.id AND c.network_id = p.network_id AND c.is_deleted = 0 AND c.created_at >= ${since}) AS comments,
            (SELECT COUNT(*) FROM post_views pv
              WHERE pv.post_id = p.id AND pv.network_id = p.network_id AND pv.viewed_at >= ${since}) AS views
       FROM posts p
       LEFT JOIN users u ON p.wallet_address = u.wallet_address
      WHERE p.wallet_address = ? AND p.is_comment IS NULL AND p.is_repost IS NULL AND p.is_deleted = 0
      ORDER BY p.created_at DESC
      LIMIT ${PERFORMANCE_SCAN_POSTS}`,
    [wallet],
  )

  const weight = (entry) => entry.likes + entry.comments * 3 + entry.views / 10
  const scored = rows
    .map((row) => ({ row, likes: Number(row.likes), comments: Number(row.comments), views: Number(row.views) }))
    .filter((entry) => entry.likes + entry.comments + entry.views > 0)
    .sort((a, b) => weight(b) - weight(a))
  const top = scored.slice(0, PERFORMANCE_TOP)
  const sum = (key) => scored.reduce((total, entry) => total + entry[key], 0)

  return {
    window_days: Math.round(window / 24),
    note: `Engagement received in the window on the member's ${PERFORMANCE_SCAN_POSTS} most recent posts`,
    posts_published: rows.filter((row) => Number(row.is_new)).length,
    totals: { likes: sum('likes'), comments: sum('comments'), views: sum('views') },
    top_posts: top.map(({ row, likes, comments, views }) => ({
      excerpt: postText(row.content, CARD_EXCERPT_CHARS),
      likes,
      comments,
      views,
      link: getPostPermalink(row),
    })),
    cards: top.map(({ row, likes, comments, views }) => postCard(row, { likes, comments, views })),
  }
}

/* The home feed's "Who to follow" rule — the leaderboard's top 20 with a name and a picture,
   never the member or anyone they follow — taken in rank order rather than shuffled, since a
   chat answer should be the best picks, not a random draw */
const getWhoToFollow = async ({ limit }, { wallet }) => {
  const count = Math.min(Math.max(Math.round(Number(limit)) || 3, 1), WHO_TO_FOLLOW_MAX)

  // Read as literals rather than joined: users and follows can differ in collation on production
  const [followed] = await pool.execute(
    'SELECT DISTINCT followed_address FROM follows WHERE follower_address = ? AND is_following = 1',
    [wallet],
  )
  const excluded = new Set([wallet, ...followed.map((row) => String(row.followed_address).toLowerCase())])

  const { rows } = await getLeaderboardSnapshot({ period: 'all', sort: 'score', networkId: null, since: null })
  const picks = rows
    .slice(0, WHO_TO_FOLLOW_POOL)
    .map((row, index) => serializeLeader(row, index + 1))
    .filter((leader) => leader.profile_image && !excluded.has(String(leader.wallet_address).toLowerCase()))
    .slice(0, count)

  return {
    people: picks.map((leader) => ({
      name: leader.display_name,
      profile: profilePath(leader.wallet_address, leader.username),
      rank: leader.rank,
      followers: leader.follower_count,
      posts: leader.total_posts,
      about: (leader.description || '').slice(0, 160),
    })),
    cards: picks.map((leader) => profileCard(leader, `#${leader.rank} · ${COMPACT.format(leader.total_posts)} posts`)),
  }
}

/* Each list is read on its own, so a chain that never got (say) markets — no table, no rows —
   only drops that section instead of failing the whole answer */
const readOrEmpty = (query, label) =>
  query
    .then(([rows]) => rows)
    .catch((error) => {
      console.warn(`[HUPI_TOOL] ${label} unavailable:`, error.message)
      return []
    })

const getClosingSoon = async ({ days }) => {
  const horizonDays = Math.min(Math.max(Math.round(Number(days)) || CLOSING_DEFAULT_DAYS, 1), CLOSING_MAX_DAYS)
  const horizon = Math.floor(Date.now() / 1000) + horizonDays * 86400

  const [polls, markets, events, tasks] = await Promise.all([
    readOrEmpty(
      pool.execute(
        `SELECT network_id, poll_id, question, closes_at, total_votes FROM polls
          WHERE closed_at = 0 AND opens_at <= UNIX_TIMESTAMP() AND closes_at > UNIX_TIMESTAMP() AND closes_at <= ?
          ORDER BY closes_at ASC LIMIT ${CLOSING_PER_KIND}`,
        [horizon],
      ),
      'polls',
    ),
    readOrEmpty(
      pool.execute(
        `SELECT network_id, market_id, title, betting_deadline FROM markets
          WHERE state = 0 AND betting_opens_at <= UNIX_TIMESTAMP() AND betting_deadline > UNIX_TIMESTAMP() AND betting_deadline <= ?
          ORDER BY betting_deadline ASC LIMIT ${CLOSING_PER_KIND}`,
        [horizon],
      ),
      'markets',
    ),
    readOrEmpty(
      pool.execute(
        `SELECT network_id, event_id, title, start_time, city FROM events
          WHERE canceled = 0 AND start_time > UNIX_TIMESTAMP() AND start_time <= ?
          ORDER BY start_time ASC LIMIT ${CLOSING_PER_KIND}`,
        [horizon],
      ),
      'events',
    ),
    readOrEmpty(
      pool.execute(
        `SELECT network_id, post_id, category, reward_per_slot, token_symbol, token_decimals, slots, paid_slots, deadline
           FROM task_bounties
          WHERE closed_at = 0 AND deadline > UNIX_TIMESTAMP() AND deadline <= ? AND paid_slots < slots
          ORDER BY deadline ASC LIMIT ${CLOSING_PER_KIND}`,
        [horizon],
      ),
      'tasks',
    ),
  ])

  const items = [
    ...polls.map((row) => ({
      kind: 'poll',
      title: row.question || 'Untitled poll',
      when: `closes ${fromNow(row.closes_at)}`,
      detail: `${COMPACT.format(Number(row.total_votes) || 0)} votes`,
      link: `/polls/${row.network_id}/${row.poll_id}`,
    })),
    ...markets.map((row) => ({
      kind: 'prediction',
      title: row.title || 'Untitled market',
      when: `betting closes ${fromNow(row.betting_deadline)}`,
      detail: null,
      link: `/predict/${row.network_id}/${row.market_id}`,
    })),
    ...events.map((row) => ({
      kind: 'event',
      title: row.title || 'Untitled event',
      when: `starts ${fromNow(row.start_time)}`,
      detail: row.city || null,
      link: '/events',
    })),
    ...tasks.map((row) => ({
      kind: 'task',
      title: `${categoryLabel(row.category)} task`,
      when: `closes ${fromNow(row.deadline)}`,
      detail: `${formatTokenAmount(row.reward_per_slot, row.token_decimals, row.token_symbol)} per reply · ${
        Number(row.slots) - Number(row.paid_slots)
      } slots left`,
      link: taskHref(row.network_id, row.post_id),
    })),
  ]

  return {
    window_days: horizonDays,
    items,
    cards: items.map((item) => ({
      kind: item.kind,
      link: item.link,
      title: item.title,
      subtitle: [item.when, item.detail].filter(Boolean).join(' · '),
    })),
  }
}

/**
 * One account as Hupi describes it: its own profile fields plus where it stands on the
 * leaderboard. `name` is null when the account never set one, so a caller can tell "no name"
 * from a wallet shown in its place. Shared by "who is this?" and the member's own greeting.
 * @param {string} address Lowercase wallet.
 */
const readProfile = async (address) => {
  const usernameColumn = (await hasColumn('users', 'username')) ? ', username' : ''
  const [[[user]], { rows }] = await Promise.all([
    pool.execute(
      `SELECT name, description, profileImage, created_at${usernameColumn} FROM users WHERE wallet_address = ? LIMIT 1`,
      [address],
    ),
    getLeaderboardSnapshot({ period: 'all', sort: 'score', networkId: null, since: null }),
  ])
  const index = rows.findIndex((row) => String(row.wallet_address).toLowerCase() === address)
  const leader = index >= 0 ? serializeLeader(rows[index], index + 1) : null
  const joined = user?.created_at ? new Date(user.created_at).getTime() : NaN

  return {
    name: (user?.name || '').trim().slice(0, PROFILE_NAME_CHARS) || null,
    handle: user?.username ? `@${user.username}` : null,
    about: (user?.description || '').slice(0, PROFILE_ABOUT_CHARS),
    image: user?.profileImage || leader?.profile_image || null,
    joined: Number.isFinite(joined) ? sinceWhen(joined / 1000) : null,
    rank: leader?.rank ?? null,
    followers: leader?.follower_count ?? 0,
    following: leader?.following_count ?? 0,
    posts: leader?.total_posts ?? 0,
    likes_received: leader?.likes_received ?? 0,
  }
}

/**
 * The asking member, for the system prompt: who Hupi is talking to, so it can greet them by name.
 * Never throws — a member Hupi cannot read is greeted without a name rather than not answered.
 * @param {string} wallet The verified wallet.
 */
export const readHupiMember = async (wallet) => {
  try {
    const { image: _image, ...member } = await readProfile(wallet)
    return member
  } catch (error) {
    console.warn('[HUPI] member profile unavailable:', error.message)
    return null
  }
}

/* "This post" / "this person": the page the member has open. Read through the same row the post
   page renders, with the same gates the rest of Hupi keeps — no community posts, nothing a
   moderator took down */
const getCurrentPage = async (_args, { page }) => {
  if (!page) return { error: 'The member is not on a post or a profile right now' }

  if (page.kind === 'post') {
    const row = await readPostRow(page.networkId, page.postId)
    if (!row || Number(row.is_deleted)) return { error: 'This post could not be found' }
    if (row.community_id) return { error: 'This post is in a community, and Hupi does not read community posts' }
    if (Number(row.actioned_reports) > 0) return { error: 'This post was removed by moderators' }

    const stats = {
      likes: Number(row.total_likes),
      comments: Number(row.total_comments),
      reposts: Number(row.total_reposts),
      views: Number(row.total_views),
    }
    return {
      kind: 'post',
      author: row.display_name || shortWallet(row.wallet_address),
      author_profile: profilePath(row.wallet_address, row.username),
      text: postText(row.content, PAGE_POST_CHARS) || '(no text, media only)',
      is_repost: Number(row.is_repost) > 0,
      posted: fromNow(new Date(row.created_at).getTime() / 1000),
      ...stats,
      link: page.path,
      cards: [{ ...postCard({ ...row, name: row.display_name }, stats), link: page.path }],
    }
  }

  let address = page.address
  if (!address && page.handle && (await hasColumn('users', 'username_key'))) {
    const [[owner]] = await pool.execute('SELECT wallet_address FROM users WHERE username_key = ? LIMIT 1', [page.handle])
    address = owner ? String(owner.wallet_address).toLowerCase() : null
  }
  if (!address) return { error: 'This profile could not be found' }

  const [profile, { premium }] = await Promise.all([readProfile(address), readPremium(address).catch(() => ({ premium: false }))])
  const { image, ...facts } = profile

  return {
    kind: 'profile',
    ...facts,
    name: facts.name || shortWallet(address),
    premium,
    link: page.path,
    cards: [
      {
        kind: 'profile',
        link: page.path,
        title: facts.name || shortWallet(address),
        image,
        subtitle: facts.rank ? `#${facts.rank} · ${COMPACT.format(facts.followers)} followers` : 'New to Hup',
      },
    ],
  }
}

// --- Definitions ---

const HOURS_PARAM = {
  type: 'integer',
  minimum: 1,
  maximum: MAX_WINDOW_HOURS,
  description: `Look-back window in hours. Defaults to ${DEFAULT_WINDOW_HOURS}.`,
}

/* `status` is what the panel shows while the tool runs, streamed ahead of the answer.
   `followUps` are the chips offered after an answer that used the tool. */
const TOOLS = {
  get_my_catchup: {
    run: getMyCatchup,
    status: 'Reading your notifications…',
    followUps: ['How did my posts do this week?', 'Who should I follow?'],
    description:
      'What the signed-in user missed: counts of what others did to them in the window (likes, comments, follows, tips, sales…) with how many people did each, their busiest posts, and their unread total. Use for "what did I miss".',
    parameters: { type: 'object', properties: { hours: HOURS_PARAM }, additionalProperties: false },
  },
  get_my_post_performance: {
    run: getMyPostPerformance,
    status: 'Adding up your posts…',
    followUps: ["What's trending right now?", 'What did I miss?'],
    description:
      'How the signed-in user\'s own posts performed: likes, comments and views received in the window, how many posts they published, and their best posts. Use for "how did my posts do".',
    parameters: {
      type: 'object',
      properties: { days: { type: 'integer', minimum: 1, maximum: 7, description: `Defaults to ${PERFORMANCE_DEFAULT_DAYS}.` } },
      additionalProperties: false,
    },
  },
  get_who_to_follow: {
    run: getWhoToFollow,
    status: 'Finding people for you…',
    followUps: ["Who's top of the leaderboard this week?", "What's trending right now?"],
    description: 'Active, top-ranked accounts the signed-in user does not follow yet, best first.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: WHO_TO_FOLLOW_MAX } },
      additionalProperties: false,
    },
  },
  get_closing_soon: {
    run: getClosingSoon,
    status: "Checking what's closing soon…",
    followUps: ["What's trending right now?", 'What did I miss?'],
    description:
      'Open polls, prediction markets and paid tasks closing soon, and events starting soon. Use for "what can I vote on, bet on, earn from or attend".',
    parameters: {
      type: 'object',
      properties: {
        days: {
          type: 'integer',
          minimum: 1,
          maximum: CLOSING_MAX_DAYS,
          description: `How far ahead to look. Defaults to ${CLOSING_DEFAULT_DAYS}.`,
        },
      },
      additionalProperties: false,
    },
  },
  get_platform_stats: {
    run: getPlatformStats,
    status: 'Counting up Hup…',
    followUps: ["What's trending right now?", "Who's top of the leaderboard this week?"],
    description:
      'Hup-wide totals and the last-24h deltas: members (new users joined), posts, comments, likes, views, tips and premium holders.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  get_leaderboard: {
    run: getLeaderboard,
    status: 'Checking the leaderboard…',
    followUps: ['Who should I follow?', "What's trending right now?"],
    description: 'The community leaderboard, top accounts by a chosen ranking.',
    parameters: {
      type: 'object',
      properties: {
        sort: { type: 'string', enum: Object.keys(SORTS), description: 'Ranking. Defaults to score.' },
        period: { type: 'string', enum: ['all', '30d', '7d'], description: 'Time scope. Defaults to all.' },
        limit: { type: 'integer', minimum: 1, maximum: LEADERBOARD_MAX },
      },
      additionalProperties: false,
    },
  },
  get_trending: {
    run: getTrending,
    status: "Looking at what's trending…",
    followUps: ["What's closing soon?", 'What did I miss?'],
    description: 'Trending public posts by recent likes and replies, and the most-mentioned cashtags in the window.',
    parameters: { type: 'object', properties: { hours: HOURS_PARAM }, additionalProperties: false },
  },
  get_current_page: {
    run: getCurrentPage,
    status: 'Reading this page…',
    followUps: ["What's trending right now?", 'Who should I follow?'],
    // Only offered while the member has a post or profile open; see hupiTools()
    pageOnly: true,
    description:
      'The post or profile the member has open right now: its text or bio, author, and numbers. Use whenever they say "this", "this post", "this person" or "who is this".',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
}

/**
 * Tool definitions in the OpenAI chat-completions shape, for one turn.
 * @param {{page: object|null}} context The page the member has open, from lib/hupiPage.
 */
export const hupiTools = ({ page }) =>
  Object.entries(TOOLS)
    .filter(([, tool]) => !tool.pageOnly || page)
    .map(([name, { description, parameters }]) => ({ type: 'function', function: { name, description, parameters } }))

/** The panel's status line for a tool, with a generic fallback for a name the model made up. */
export const hupiToolStatus = (name) => (Object.hasOwn(TOOLS, name) ? TOOLS[name].status : 'Checking Hup…')

/**
 * The chips to offer after an answer: the follow-ups of every tool it used, minus the question
 * just asked, at most three.
 * @param {string[]} names Tools the turn called.
 * @param {string} question The member's last message.
 */
export const hupiFollowUps = (names, question) => {
  const asked = String(question).trim().toLowerCase()
  const chips = names.flatMap((name) => (Object.hasOwn(TOOLS, name) ? TOOLS[name].followUps : []))
  return [...new Set(chips)].filter((chip) => chip.toLowerCase() !== asked).slice(0, MAX_FOLLOW_UPS)
}

/**
 * Run one tool call. Never throws: a failed tool is reported back to the model as data, so it
 * can say what it could not read instead of the whole answer failing. Cards come back apart from
 * the result — the model never reads them; the route shows the ones its reply links to.
 * @param {string} name
 * @param {string} rawArgs The model's JSON argument string.
 * @param {{wallet: string, page: object|null}} context The verified wallet asking, and its page.
 * @returns {Promise<{result: object, cards: object[]}>}
 */
export const runHupiTool = async (name, rawArgs, context) => {
  const tool = Object.hasOwn(TOOLS, name) ? TOOLS[name] : null
  if (!tool) return { result: { error: `Unknown tool ${name}` }, cards: [] }

  let args = {}
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {}
  } catch {
    return { result: { error: 'Arguments were not valid JSON' }, cards: [] }
  }

  try {
    const { cards = [], ...result } = await tool.run(args && typeof args === 'object' ? args : {}, context)
    return { result, cards }
  } catch (error) {
    console.error(`[HUPI_TOOL_ERROR] ${name}:`, error.message)
    return { result: { error: 'This data could not be read right now' }, cards: [] }
  }
}

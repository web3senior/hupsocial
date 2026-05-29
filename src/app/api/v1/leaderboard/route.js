import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

const PERIODS = {
  all: null,
  '30d': 30,
  '7d': 7,
}

const SORTS = {
  score: 'ranked.score DESC, ranked.likes_received DESC, ranked.root_posts DESC, ranked.latest_post_at DESC',
  posts: 'ranked.root_posts DESC, ranked.score DESC, ranked.latest_post_at DESC',
  engagement: 'ranked.likes_received DESC, ranked.reposts_made DESC, ranked.score DESC',
  views: 'ranked.views_received DESC, ranked.score DESC, ranked.latest_post_at DESC',
}

const SCORE_SQL = `
  (COALESCE(activity.root_posts, 0) * 10) +
  (COALESCE(activity.comments_made, 0) * 4) +
  (COALESCE(activity.reposts_made, 0) * 5) +
  (COALESCE(received.likes_received, 0) * 8) +
  (COALESCE(given.likes_given, 0) * 1) +
  (COALESCE(views.views_received, 0) * 1) +
  (COALESCE(u.follower_count, 0) * 12)
`

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)

    const page = clampNumber(parseInt(searchParams.get('page'), 10), 1, 1000, 1)
    const limit = clampNumber(parseInt(searchParams.get('limit'), 10), 1, 100, 20)
    const offset = (page - 1) * limit
    const period = normalizePeriod(searchParams.get('period'))
    const sort = SORTS[searchParams.get('sort')] ? searchParams.get('sort') : 'score'
    const networkId = normalizeNetworkId(searchParams.get('network_id'))
    const since = getSinceDate(period)

    const activityFilter = buildWhere({
      alias: 'p',
      timeColumn: 'created_at',
      networkId,
      since,
      baseConditions: ['p.wallet_address IS NOT NULL'],
    })

    const receivedFilter = buildWhere({
      alias: 'pl',
      timeColumn: 'created_at',
      networkId,
      since,
    })

    const givenFilter = buildWhere({
      alias: 'pl',
      timeColumn: 'created_at',
      networkId,
      since,
      baseConditions: ['pl.liker_address IS NOT NULL'],
    })

    const viewsFilter = buildWhere({
      alias: 'pv',
      timeColumn: 'viewed_at',
      networkId,
      since,
    })

    const query = `
      SELECT ranked.*
      FROM (
        SELECT
          wallets.wallet_address,
          NULLIF(u.name, '') AS display_name,
          u.description,
          u.profileImage AS profile_image,
          COALESCE(u.follower_count, 0) AS follower_count,
          COALESCE(u.following_count, 0) AS following_count,
          u.created_at,
          COALESCE(activity.total_posts, 0) AS total_posts,
          COALESCE(activity.root_posts, 0) AS root_posts,
          COALESCE(activity.comments_made, 0) AS comments_made,
          COALESCE(activity.reposts_made, 0) AS reposts_made,
          COALESCE(activity.latest_post_at, NULL) AS latest_post_at,
          COALESCE(received.likes_received, 0) AS likes_received,
          COALESCE(given.likes_given, 0) AS likes_given,
          COALESCE(views.views_received, 0) AS views_received,
          ${SCORE_SQL} AS score
        FROM (
          SELECT CONVERT(wallet_address USING utf8mb4) COLLATE utf8mb4_general_ci AS wallet_address FROM users
          UNION
          SELECT CONVERT(wallet_address USING utf8mb4) COLLATE utf8mb4_general_ci AS wallet_address FROM posts WHERE wallet_address IS NOT NULL
          UNION
          SELECT CONVERT(liker_address USING utf8mb4) COLLATE utf8mb4_general_ci AS wallet_address FROM post_likes WHERE liker_address IS NOT NULL
        ) wallets
        LEFT JOIN users u ON u.wallet_address = wallets.wallet_address
        LEFT JOIN (
          SELECT
            CONVERT(p.wallet_address USING utf8mb4) COLLATE utf8mb4_general_ci AS wallet_address,
            COUNT(*) AS total_posts,
            SUM(CASE WHEN p.is_comment IS NULL AND p.is_repost IS NULL THEN 1 ELSE 0 END) AS root_posts,
            SUM(CASE WHEN p.is_comment IS NOT NULL THEN 1 ELSE 0 END) AS comments_made,
            SUM(CASE WHEN p.is_repost IS NOT NULL THEN 1 ELSE 0 END) AS reposts_made,
            MAX(p.created_at) AS latest_post_at
          FROM posts p
          ${activityFilter.where}
          GROUP BY CONVERT(p.wallet_address USING utf8mb4) COLLATE utf8mb4_general_ci
        ) activity ON activity.wallet_address = wallets.wallet_address
        LEFT JOIN (
          SELECT
            CONVERT(p.wallet_address USING utf8mb4) COLLATE utf8mb4_general_ci AS wallet_address,
            COUNT(pl.id) AS likes_received
          FROM post_likes pl
          JOIN posts p ON pl.post_id = p.id AND pl.network_id = p.network_id
          ${receivedFilter.where}
          GROUP BY CONVERT(p.wallet_address USING utf8mb4) COLLATE utf8mb4_general_ci
        ) received ON received.wallet_address = wallets.wallet_address
        LEFT JOIN (
          SELECT
            CONVERT(pl.liker_address USING utf8mb4) COLLATE utf8mb4_general_ci AS wallet_address,
            COUNT(*) AS likes_given
          FROM post_likes pl
          ${givenFilter.where}
          GROUP BY CONVERT(pl.liker_address USING utf8mb4) COLLATE utf8mb4_general_ci
        ) given ON given.wallet_address = wallets.wallet_address
        LEFT JOIN (
          SELECT
            CONVERT(p.wallet_address USING utf8mb4) COLLATE utf8mb4_general_ci AS wallet_address,
            COUNT(pv.id) AS views_received
          FROM post_views pv
          JOIN posts p ON pv.post_id = p.id AND pv.network_id = p.network_id
          ${viewsFilter.where}
          GROUP BY CONVERT(p.wallet_address USING utf8mb4) COLLATE utf8mb4_general_ci
        ) views ON views.wallet_address = wallets.wallet_address
      ) ranked
      WHERE ranked.score > 0
      ORDER BY ${SORTS[sort]}
      LIMIT ? OFFSET ?
    `

    const params = [
      ...activityFilter.params,
      ...receivedFilter.params,
      ...givenFilter.params,
      ...viewsFilter.params,
      limit + 1,
      offset,
    ]

    const [rows] = await pool.execute(query, params)
    const hasMore = rows.length > limit
    const leaders = hasMore ? rows.slice(0, limit) : rows
    const nextPage = hasMore ? page + 1 : null

    const [statsRows] = await pool.execute(buildStatsQuery(networkId, since), buildStatsParams(networkId, since))
    const [networks] = await pool.execute('SELECT id, name FROM networks ORDER BY name ASC')

    return NextResponse.json({
      success: true,
      data: leaders.map((row, index) => serializeLeader(row, offset + index + 1)),
      nextPage,
      meta: {
        page,
        count: leaders.length,
        hasMore,
        period,
        sort,
        network_id: networkId,
        stats: serializeStats(statsRows[0]),
        networks,
      },
    })
  } catch (error) {
    console.error('[LEADERBOARD_ERROR]:', error.message)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch leaderboard',
        details: process.env.NODE_ENV === 'production' ? undefined : error.message,
      },
      { status: 500 },
    )
  }
}

function buildStatsQuery(networkId, since) {
  const postFilter = buildWhere({
    alias: 'p',
    timeColumn: 'created_at',
    networkId,
    since,
    baseConditions: ['p.wallet_address IS NOT NULL'],
  })
  const likeFilter = buildWhere({
    alias: 'pl',
    timeColumn: 'created_at',
    networkId,
    since,
  })
  const viewFilter = buildWhere({
    alias: 'pv',
    timeColumn: 'viewed_at',
    networkId,
    since,
  })

  return `
    SELECT
      (SELECT COUNT(DISTINCT p.wallet_address) FROM posts p ${postFilter.where}) AS active_users,
      (SELECT COUNT(*) FROM posts p ${postFilter.where} AND p.is_comment IS NULL AND p.is_repost IS NULL) AS root_posts,
      (SELECT COUNT(*) FROM posts p ${postFilter.where} AND p.is_comment IS NOT NULL) AS comments,
      (SELECT COUNT(*) FROM post_likes pl ${likeFilter.where}) AS likes,
      (SELECT COUNT(*) FROM post_views pv ${viewFilter.where}) AS views
  `
}

function buildStatsParams(networkId, since) {
  const postFilter = buildWhere({
    alias: 'p',
    timeColumn: 'created_at',
    networkId,
    since,
    baseConditions: ['p.wallet_address IS NOT NULL'],
  })
  const likeFilter = buildWhere({
    alias: 'pl',
    timeColumn: 'created_at',
    networkId,
    since,
  })
  const viewFilter = buildWhere({
    alias: 'pv',
    timeColumn: 'viewed_at',
    networkId,
    since,
  })

  return [
    ...postFilter.params,
    ...postFilter.params,
    ...postFilter.params,
    ...likeFilter.params,
    ...viewFilter.params,
  ]
}

function buildWhere({ alias, timeColumn, networkId, since, baseConditions = [] }) {
  const conditions = [...baseConditions]
  const params = []

  if (networkId) {
    conditions.push(`${alias}.network_id = ?`)
    params.push(networkId)
  }

  if (since) {
    conditions.push(`${alias}.${timeColumn} >= ?`)
    params.push(since)
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  }
}

function normalizePeriod(period) {
  return Object.prototype.hasOwnProperty.call(PERIODS, period) ? period : 'all'
}

function normalizeNetworkId(value) {
  if (!value || value === 'all') return null
  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function getSinceDate(period) {
  const days = PERIODS[period]
  if (!days) return null

  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

function serializeLeader(row, rank) {
  const wallet = row.wallet_address

  return {
    rank,
    wallet_address: wallet,
    display_name: row.display_name || formatWallet(wallet),
    description: row.description || '',
    profile_image: row.profile_image || null,
    follower_count: toNumber(row.follower_count),
    following_count: toNumber(row.following_count),
    total_posts: toNumber(row.total_posts),
    root_posts: toNumber(row.root_posts),
    comments_made: toNumber(row.comments_made),
    reposts_made: toNumber(row.reposts_made),
    likes_received: toNumber(row.likes_received),
    likes_given: toNumber(row.likes_given),
    views_received: toNumber(row.views_received),
    score: toNumber(row.score),
    latest_post_at: row.latest_post_at,
  }
}

function serializeStats(stats = {}) {
  return {
    active_users: toNumber(stats.active_users),
    root_posts: toNumber(stats.root_posts),
    comments: toNumber(stats.comments),
    likes: toNumber(stats.likes),
    views: toNumber(stats.views),
  }
}

function toNumber(value) {
  return Number(value || 0)
}

function formatWallet(wallet = '') {
  if (wallet.length <= 12) return wallet || 'Unknown user'
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`
}
/**
 * @file api/v1/users/[address]/insights/route.js
 * @description Aggregate insights for a wallet's own profile: follower growth, profile views,
 * post reach/engagement, top posts, and per-network breakdowns, bucketed over a selectable date range. The follower
 * count mirrors the aggregate already trusted by the followers list endpoint
 * (users.follower_count is never written anywhere in this codebase, so it isn't used here).
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

const PERIOD_DAYS = {
  '7d': 7,
  '14d': 14,
  '30d': 30,
  '90d': 90,
}

export async function GET(request, { params }) {
  try {
    const { address } = await params
    const { searchParams } = new URL(request.url)

    if (!address) {
      return NextResponse.json({ success: false, error: 'Missing profile address' }, { status: 400 })
    }

    const wallet = address.toLowerCase()
    const days = PERIOD_DAYS[searchParams.get('period')] || 30

    // Anchor "today" to the DB's own clock rather than Node's — DATE_FORMAT() below reflects the
    // DB session's timezone, so building the day range off Date.now() (UTC) could disagree with it
    // at day boundaries and silently drop today's bucket.
    const [[{ today }]] = await pool.execute(`SELECT DATE_FORMAT(NOW(), '%Y-%m-%d') AS today`)
    const since = getSinceDate(today, days)

    const [[{ follower_count: followerCount }]] = await pool.execute(
      `SELECT COUNT(DISTINCT follower_address) AS follower_count FROM follows WHERE followed_address = ? AND is_following = 1`,
      [wallet],
    )

    const [followerGrowth, profileViews, reach, topPosts, networkBreakdown] = await Promise.all([
      getFollowerGrowth(wallet, since, today, days),
      getDailySeries('profile_views', 'viewed_at', 'wallet_address', wallet, since, today, days),
      getReach(wallet, since, today, days),
      getTopPosts(wallet, since),
      getNetworkBreakdown(wallet, since),
    ])

    return NextResponse.json({
      success: true,
      data: {
        follower_count: followerCount,
        follower_growth: followerGrowth,
        profile_views: profileViews,
        reach,
        top_posts: topPosts,
        posts_by_network: networkBreakdown.postsByNetwork,
        engagement_by_network: networkBreakdown.engagementByNetwork,
      },
    })
  } catch (error) {
    console.error('[INSIGHTS_FETCH_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

/* Reconstructs daily follower counts from the follows table's toggle history: each is_following=1
 * row is a +1 on its updated_at day, each is_following=0 row is a -1, so a baseline before the
 * period plus a running cumulative sum through it reproduces the count on every day. */
async function getFollowerGrowth(wallet, since, today, days) {
  const [[{ baseline }]] = await pool.execute(
    `SELECT COALESCE(SUM(CASE WHEN is_following = 1 THEN 1 ELSE -1 END), 0) AS baseline
     FROM follows WHERE followed_address = ? AND updated_at < ?`,
    [wallet, since],
  )

  const [rows] = await pool.execute(
    `SELECT DATE_FORMAT(updated_at, '%Y-%m-%d') AS day, SUM(CASE WHEN is_following = 1 THEN 1 ELSE -1 END) AS delta
     FROM follows WHERE followed_address = ? AND updated_at >= ?
     GROUP BY day`,
    [wallet, since],
  )

  const deltaByDay = new Map(rows.map((r) => [formatDay(r.day), Number(r.delta)]))

  let running = Number(baseline)
  return buildDayRange(today, days).map((day) => {
    running += deltaByDay.get(day) || 0
    return { date: day, count: Math.max(running, 0) }
  })
}

async function getDailySeries(table, timeColumn, addressColumn, wallet, since, today, days) {
  const [rows] = await pool.execute(
    `SELECT DATE_FORMAT(${timeColumn}, '%Y-%m-%d') AS day, COUNT(*) AS count
     FROM ${table} WHERE ${addressColumn} = ? AND ${timeColumn} >= ?
     GROUP BY day`,
    [wallet, since],
  )

  const countByDay = new Map(rows.map((r) => [formatDay(r.day), Number(r.count)]))
  return buildDayRange(today, days).map((day) => ({ date: day, count: countByDay.get(day) || 0 }))
}

async function getReach(wallet, since, today, days) {
  const [viewRows, likeRows, commentRows] = await Promise.all([
    pool.execute(
      `SELECT DATE_FORMAT(pv.viewed_at, '%Y-%m-%d') AS day, COUNT(*) AS total
       FROM post_views pv
       JOIN posts p ON pv.post_id = p.id AND pv.network_id = p.network_id
       WHERE p.wallet_address = ? AND p.is_comment IS NULL AND p.is_deleted = 0 AND pv.viewed_at >= ?
       GROUP BY day`,
      [wallet, since],
    ),
    pool.execute(
      `SELECT DATE_FORMAT(pl.liked_at, '%Y-%m-%d') AS day, COUNT(*) AS total
       FROM post_likes pl
       JOIN posts p ON pl.post_id = p.id AND pl.network_id = p.network_id
       WHERE p.wallet_address = ? AND p.is_comment IS NULL AND p.is_deleted = 0
         AND pl.is_active = 1 AND pl.liked_at >= ?
       GROUP BY day`,
      [wallet, since],
    ),
    pool.execute(
      `SELECT DATE_FORMAT(c.created_at, '%Y-%m-%d') AS day, COUNT(*) AS total
       FROM posts c
       JOIN posts p ON c.is_comment = p.id AND c.network_id = p.network_id
       WHERE p.wallet_address = ? AND p.is_comment IS NULL AND p.is_deleted = 0 AND c.created_at >= ?
       GROUP BY day`,
      [wallet, since],
    ),
  ])

  const viewsByDay = new Map(viewRows[0].map((r) => [formatDay(r.day), Number(r.total)]))
  const likesByDay = new Map(likeRows[0].map((r) => [formatDay(r.day), Number(r.total)]))
  const commentsByDay = new Map(commentRows[0].map((r) => [formatDay(r.day), Number(r.total)]))

  return buildDayRange(today, days).map((day) => ({
    date: day,
    views: viewsByDay.get(day) || 0,
    likes: likesByDay.get(day) || 0,
    comments: commentsByDay.get(day) || 0,
  }))
}

async function getTopPosts(wallet, since) {
  const [rows] = await pool.execute(
    `SELECT * FROM (
       SELECT
         p.id AS post_id,
         p.network_id,
         p.content,
         (SELECT COUNT(*) FROM post_views pv WHERE pv.post_id = p.id AND pv.network_id = p.network_id AND pv.viewed_at >= ?) AS views,
         (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id AND pl.network_id = p.network_id AND pl.is_active = 1 AND pl.liked_at >= ?) AS likes,
         (SELECT COUNT(*) FROM posts c WHERE c.is_comment = p.id AND c.network_id = p.network_id AND c.created_at >= ?) AS comments
       FROM posts p
       WHERE p.wallet_address = ? AND p.is_comment IS NULL AND p.is_deleted = 0
     ) ranked
     ORDER BY (ranked.views + ranked.likes * 2 + ranked.comments * 3) DESC
     LIMIT 5`,
    [since, since, since, wallet],
  )

  return rows.map((row) => ({
    post_id: row.post_id,
    network_id: row.network_id,
    content: parseIPFSContent(row.content),
    views: Number(row.views),
    likes: Number(row.likes),
    comments: Number(row.comments),
  }))
}

/* Groups the wallet's original posts and the engagement they received (active likes + comments on
 * those posts) by network, for the breakdown pies. Likes and comments live in different tables, so
 * engagement is merged per network in JS after the grouped queries. */
async function getNetworkBreakdown(wallet, since) {
  const [postRows, likeRows, commentRows] = await Promise.all([
    pool.execute(
      `SELECT p.network_id, n.name, COUNT(*) AS total
       FROM posts p
       JOIN networks n ON p.network_id = n.id
       WHERE p.wallet_address = ? AND p.is_comment IS NULL AND p.is_deleted = 0 AND p.created_at >= ?
       GROUP BY p.network_id, n.name`,
      [wallet, since],
    ),
    pool.execute(
      `SELECT p.network_id, n.name, COUNT(*) AS total
       FROM post_likes pl
       JOIN posts p ON pl.post_id = p.id AND pl.network_id = p.network_id
       JOIN networks n ON p.network_id = n.id
       WHERE p.wallet_address = ? AND p.is_comment IS NULL AND p.is_deleted = 0
         AND pl.is_active = 1 AND pl.liked_at >= ?
       GROUP BY p.network_id, n.name`,
      [wallet, since],
    ),
    pool.execute(
      `SELECT p.network_id, n.name, COUNT(*) AS total
       FROM posts c
       JOIN posts p ON c.is_comment = p.id AND c.network_id = p.network_id
       JOIN networks n ON p.network_id = n.id
       WHERE p.wallet_address = ? AND p.is_comment IS NULL AND p.is_deleted = 0 AND c.created_at >= ?
       GROUP BY p.network_id, n.name`,
      [wallet, since],
    ),
  ])

  const postsByNetwork = postRows[0]
    .map((row) => ({ network_id: row.network_id, name: row.name, count: Number(row.total) }))
    .sort((a, b) => b.count - a.count)

  const engagementByNetworkId = new Map()
  for (const row of [...likeRows[0], ...commentRows[0]]) {
    const entry = engagementByNetworkId.get(row.network_id) || { network_id: row.network_id, name: row.name, count: 0 }
    entry.count += Number(row.total)
    engagementByNetworkId.set(row.network_id, entry)
  }
  const engagementByNetwork = [...engagementByNetworkId.values()].sort((a, b) => b.count - a.count)

  return { postsByNetwork, engagementByNetwork }
}

// `today` is the DB's own DATE_FORMAT(NOW(), '%Y-%m-%d') string — treating it as UTC midnight here
// is just a stable anchor for day arithmetic, not a claim about the DB's real timezone.
function getSinceDate(today, days) {
  const date = new Date(`${today}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - (days - 1))
  return date.toISOString().slice(0, 10) + ' 00:00:00'
}

function buildDayRange(today, days) {
  const anchor = new Date(`${today}T00:00:00Z`)
  const range = []
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(anchor)
    date.setUTCDate(date.getUTCDate() - i)
    range.push(date.toISOString().slice(0, 10))
  }
  return range
}

function formatDay(value) {
  return String(value)
}

function parseIPFSContent(content) {
  try {
    return JSON.parse(content)
  } catch (e) {
    return content
  }
}

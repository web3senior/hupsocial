/**
 * @file api/v1/posts/route.js
 * @description Fetches indexed posts with multichain support filtering by chain_id, computes live engagement metrics from the unified posts table, and verifies viewer likes.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'
import { getFollowingAddresses } from '@/lib/followSystem'
import { ensureStoreListingsTable } from '@/lib/storeListingsIndex'

export const runtime = 'nodejs'

// --- Trending feed configuration ---
// Velocity ranking: posts are scored by engagement RECEIVED inside a trailing
// window (not by post age), so an older post that catches fire can still trend.
// The ranked candidate list is identical for every viewer, so it is cached in
// module scope and only viewer flags (has_liked/has_bookmarked) run per request.
const TRENDING_CACHE_TTL_MS = 60_000
const TRENDING_CANDIDATE_LIMIT = 100
const TRENDING_MIN_SCORE = 2
const TRENDING_WINDOWS_HOURS = [24, 168] // 24h first; 7-day fallback keeps a quiet network from an empty tab
const TRENDING_COMMENT_WEIGHT = 3 // comments are costlier to fake than likes

const trendingCache = new Map()

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)

    // Pagination parameters
    const page = parseInt(searchParams.get('page')) || 1
    const limit = parseInt(searchParams.get('limit')) || 20
    const offset = (page - 1) * limit

    // Filters and viewer context
    const networkId = searchParams.get('network_id')
    const walletAddress = searchParams.get('wallet_address')
    const communityId = searchParams.get('community_id')
    const viewerAddress = searchParams.get('viewer_address')
    const feedType = searchParams.get('feed_type')

    // Trending is viewer-independent in its ranking, so it short-circuits into
    // its own cached pipeline before the per-viewer query below.
    if (feedType === 'trending') {
      return await handleTrendingFeed({ networkId, viewerAddress, page, limit, offset })
    }

    // "Following" mode reads the followed-address list live on-chain (no indexer),
    // so it needs to short-circuit before touching MySQL when unsupported/empty.
    let followingAddresses = null
    if (feedType === 'following') {
      if (!networkId || !viewerAddress) {
        return NextResponse.json(
          { success: false, error: 'feed_type=following requires network_id and viewer_address' },
          { status: 400 },
        )
      }

      const { supported, addresses } = await getFollowingAddresses(networkId, viewerAddress)
      if (!supported || addresses.length === 0) {
        return NextResponse.json({
          success: true,
          data: [],
          nextPage: null,
          meta: { page, count: 0, hasMore: false, followingSupported: supported },
        })
      }
      followingAddresses = addresses
    }

    // WHERE clause and its params are built separately from the SELECT so the same filters can
    // drive both the page query and the profile total-count query below.
    let whereClause = ` WHERE p.is_comment IS NULL AND p.is_deleted = 0`
    const whereParams = []

    // "Premium" (bazzar) = posts with an active HupBazzar listing. Listings live onchain keyed
    // by postId with no enumeration, so this reads the server-verified store_listings
    // discovery index (see lib/storeListingsIndex.js). Everything else — ordering, visibility
    // rules, pagination — rides the same chronological pipeline as the home feed.
    if (feedType === 'premium') {
      await ensureStoreListingsTable()
      whereClause += ` AND EXISTS (
        SELECT 1 FROM store_listings sl
        WHERE sl.network_id = p.network_id AND sl.post_id = p.id AND sl.is_active = 1
      )`
    }

    // Apply dynamic filters using the direct performance indexes set on the posts table
    if (networkId) {
      whereClause += ` AND p.network_id = ?`
      whereParams.push(networkId)
    }
    if (followingAddresses) {
      whereClause += ` AND p.wallet_address IN (${followingAddresses.map(() => '?').join(',')})`
      whereParams.push(...followingAddresses)
    } else if (walletAddress) {
      whereClause += ` AND p.wallet_address = ?`
      whereParams.push(walletAddress)
    }
    if (communityId) {
      whereClause += ` AND p.community_id = ?`
      whereParams.push(communityId)
    } else if (viewerAddress) {
      // Outside a community's own feed (home, profile, following), PUBLIC community posts (0)
      // surface for everyone. Posts in ENCRYPTED membership types (1-5, 8 — see
      // isEncryptedMembershipType in communityVault.js) are listed only for viewers who can
      // actually read them: the post author or an active member of that community. Everyone
      // else doesn't see them at all — even a sealed envelope leaks author + existence
      // metadata if listed. Plaintext gated types (whitelist 6, paid 7) and unresolvable
      // communities (comm row not indexed yet) stay hidden for all viewers. LOWER() on both
      // sides because cidex stores checksummed addresses in binary-collated columns.
      whereClause += ` AND (
        p.community_id IS NULL
        OR comm.membership_type = 0
        OR (
          comm.membership_type IN (1, 2, 3, 4, 5, 8)
          AND (
            LOWER(p.wallet_address) = LOWER(?)
            OR EXISTS (
              SELECT 1 FROM community_members cm
              WHERE cm.network_id = p.network_id
                AND cm.community_id = p.community_id
                AND LOWER(cm.wallet_address) = LOWER(?)
                AND cm.is_member = 1
                AND cm.is_banned = 0
            )
          )
        )
      )`
      whereParams.push(viewerAddress, viewerAddress)
    } else {
      // Anonymous viewers (no connected wallet) only ever see public-community posts.
      whereClause += ` AND (p.community_id IS NULL OR comm.membership_type = 0)`
    }

    // Push the viewer address parameter first (twice) if it exists to match the conditional subquery placements
    const queryParams = []
    if (viewerAddress) {
      queryParams.push(viewerAddress, viewerAddress)
    }
    queryParams.push(...whereParams)

    // Build the Base Query with User Profile, Network Joins, and unified Metric calculations,
    // then apply sorting and pagination
    const query = `${buildPostSelect(viewerAddress)}
      ${whereClause}
      ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
    queryParams.push(limit + 1, offset)

    /* Execute using standardized pool */
    const [rows] = await pool.execute(query, queryParams)

    // Profile feeds show a total post count next to the Posts tab, so a wallet-scoped request
    // also gets the full filtered count (page-independent) in meta.total.
    let total = null
    if (walletAddress && !followingAddresses) {
      const [countRows] = await pool.execute(
        `SELECT COUNT(*) AS total
         FROM posts p
         JOIN networks n ON p.network_id = n.id
         LEFT JOIN communities comm ON comm.network_id = p.network_id AND comm.id = p.community_id
         ${whereClause}`,
        whereParams,
      )
      total = Number(countRows[0]?.total ?? 0)
    }

    // Handle "Has More" for infinite scroll
    const hasMore = rows.length > limit
    const postsToSend = hasMore ? rows.slice(0, limit) : rows
    const nextPage = hasMore ? page + 1 : null

    // Fulfill any missing Universal Profile fields
    await fulfillUniversalProfiles(postsToSend, pool)

    return NextResponse.json({
      success: true,
      data: postsToSend.map(post => ({
        ...post,
        // Map the boolean identifier to match your frontend expectations cleanly
        is_liked: Boolean(post.has_liked),
        is_bookmarked: Boolean(post.has_bookmarked),
        // Safely handle IPFS JSON data
        content: parseIPFSContent(post.content)
      })),
      nextPage,
      meta: {
        page,
        count: postsToSend.length,
        total,
        hasMore,
        filter_chain_id: networkId || 'all',
        filter_community_id: communityId || null
      }
    })

  } catch (error) {
    console.error('[POSTS_FETCH_ERROR]:', error.message)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch posts' }, 
      { status: 500 }
    )
  }
}

/**
 * Helper to safely handle IPFS JSON data stored in the DB
 */
function parseIPFSContent(content) {
  try {
    return JSON.parse(content)
  } catch (e) {
    return content
  }
}

/**
 * Shared SELECT skeleton (profile/network joins + unified metric subqueries)
 * used by both the chronological feed and the trending hydration query.
 * When viewerAddress is set, callers must push it TWICE at the head of their
 * params array to fill the has_liked/has_bookmarked placeholders.
 */
function buildPostSelect(viewerAddress) {
  return `
      SELECT
        p.*,
        u.name as display_name,
        u.profileImage as profile_image,
        n.name as network_name,
        n.explorer_url,
        comm.name as community_name,
        (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id AND network_id = p.network_id) as total_likes,
        (SELECT COUNT(*) FROM posts WHERE is_comment = p.id AND network_id = p.network_id) as total_comments,
        (SELECT COUNT(*) FROM posts WHERE is_repost = p.id AND network_id = p.network_id AND is_deleted = 0)
        + (SELECT COUNT(*) FROM posts q WHERE q.network_id = p.network_id AND q.is_deleted = 0
           AND CASE WHEN JSON_VALID(q.content) THEN JSON_UNQUOTE(JSON_EXTRACT(q.content, '$.quoteOf')) = CAST(p.id AS CHAR) ELSE 0 END) as total_reposts,
        (SELECT COUNT(*) FROM post_views WHERE post_id = p.id AND network_id = p.network_id) as total_views,
        (SELECT COUNT(*) FROM post_bookmarks WHERE post_id = p.id AND network_id = p.network_id) as total_bookmarks,
        (SELECT COUNT(*) FROM user_reports WHERE post_id = p.id AND network_id = p.network_id AND status = 'actioned') as actioned_reports,
        ${viewerAddress ? `(SELECT EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND network_id = p.network_id AND liker_address  = ?))` : '0'} as has_liked,
        ${viewerAddress ? `(SELECT EXISTS(SELECT 1 FROM post_bookmarks WHERE post_id = p.id AND network_id = p.network_id AND wallet_address = ?))` : '0'} as has_bookmarked
      FROM posts p
      LEFT JOIN users u ON p.wallet_address = u.wallet_address
      JOIN networks n ON p.network_id = n.id
      LEFT JOIN communities comm ON comm.network_id = p.network_id AND comm.id = p.community_id
  `
}

/**
 * Serves feed_type=trending: paginates the cached viewer-independent ranking,
 * then hydrates only the requested slice with full rows + viewer flags.
 */
async function handleTrendingFeed({ networkId, viewerAddress, page, limit, offset }) {
  const { candidates, windowHours } = await getTrendingCandidates(networkId)

  const slice = candidates.slice(offset, offset + limit)
  const hasMore = offset + limit < candidates.length
  const trendingMeta = { feed_type: 'trending', trending_window_hours: windowHours, filter_chain_id: networkId || 'all' }

  if (slice.length === 0) {
    return NextResponse.json({
      success: true,
      data: [],
      nextPage: null,
      meta: { page, count: 0, hasMore: false, ...trendingMeta },
    })
  }

  const queryParams = []
  if (viewerAddress) {
    queryParams.push(viewerAddress, viewerAddress)
  }

  // Posts are keyed per network, so the slice is matched on (id, network_id) tuples
  const query = `${buildPostSelect(viewerAddress)}
      WHERE (p.id, p.network_id) IN (${slice.map(() => '(?, ?)').join(', ')})
  `
  slice.forEach((candidate) => queryParams.push(candidate.id, candidate.network_id))

  const [rows] = await pool.execute(query, queryParams)

  // IN() loses ranking order — restore it from the cached slice
  const rowsByKey = new Map(rows.map((row) => [`${row.network_id}:${row.id}`, row]))
  const orderedPosts = slice
    .map((candidate) => {
      const row = rowsByKey.get(`${candidate.network_id}:${candidate.id}`)
      return row ? { ...row, trending_score: Number(candidate.score) } : null
    })
    .filter(Boolean)

  await fulfillUniversalProfiles(orderedPosts, pool)

  return NextResponse.json({
    success: true,
    data: orderedPosts.map((post) => ({
      ...post,
      is_liked: Boolean(post.has_liked),
      is_bookmarked: Boolean(post.has_bookmarked),
      content: parseIPFSContent(post.content),
    })),
    nextPage: hasMore ? page + 1 : null,
    meta: { page, count: orderedPosts.length, hasMore, ...trendingMeta },
  })
}

/**
 * Returns the cached trending ranking for a network scope, recomputing at most
 * once per TRENDING_CACHE_TTL_MS. Tries each window in order and keeps the
 * first one that yields results.
 */
async function getTrendingCandidates(networkId) {
  const cacheKey = networkId || 'all'
  const cached = trendingCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  let value = { candidates: [], windowHours: TRENDING_WINDOWS_HOURS[0] }
  for (const windowHours of TRENDING_WINDOWS_HOURS) {
    const candidates = await queryTrendingWindow(networkId, windowHours)
    if (candidates.length > 0) {
      value = { candidates, windowHours }
      break
    }
  }

  trendingCache.set(cacheKey, { value, expiresAt: Date.now() + TRENDING_CACHE_TTL_MS })
  return value
}

/**
 * Scores posts by engagement received inside the window (velocity), keeping
 * only publicly visible, non-actioned posts above the minimum score — trending
 * is an amplification surface, so moderation gates it harder than the feed.
 * Window/weight values are module constants, never user input, so they are
 * interpolated directly.
 */
async function queryTrendingWindow(networkId, windowHours) {
  const params = []
  let query = `
    SELECT p.id, p.network_id, p.wallet_address, agg.score
    FROM (
      SELECT post_id, network_id, SUM(pts) AS score
      FROM (
        SELECT post_id, network_id, 1 AS pts
        FROM post_likes
        WHERE is_active = 1 AND liked_at >= NOW() - INTERVAL ${windowHours} HOUR
        UNION ALL
        SELECT is_comment, network_id, ${TRENDING_COMMENT_WEIGHT}
        FROM posts
        WHERE is_comment IS NOT NULL AND is_deleted = 0 AND created_at >= NOW() - INTERVAL ${windowHours} HOUR
      ) events
      GROUP BY post_id, network_id
    ) agg
    JOIN posts p ON p.id = agg.post_id AND p.network_id = agg.network_id
    LEFT JOIN communities comm ON comm.network_id = p.network_id AND comm.id = p.community_id
    WHERE p.is_comment IS NULL AND p.is_deleted = 0
      AND (p.community_id IS NULL OR comm.membership_type = 0)
      AND agg.score >= ${TRENDING_MIN_SCORE}
      AND NOT EXISTS (
        SELECT 1 FROM user_reports ur
        WHERE ur.post_id = p.id AND ur.network_id = p.network_id AND ur.status = 'actioned'
      )
  `
  if (networkId) {
    query += ` AND p.network_id = ?`
    params.push(networkId)
  }
  query += ` ORDER BY agg.score DESC, p.created_at DESC LIMIT ${TRENDING_CANDIDATE_LIMIT}`

  const [rows] = await pool.execute(query, params)

  // One trending slot per author (their highest-scored post) so a posting
  // spree can't occupy the whole surface
  const seenAuthors = new Set()
  return rows.filter((row) => {
    if (seenAuthors.has(row.wallet_address)) return false
    seenAuthors.add(row.wallet_address)
    return true
  })
}
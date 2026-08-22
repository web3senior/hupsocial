/**
 * @file api/v1/posts/route.js
 * @description Fetches indexed posts with multichain support filtering by chain_id, computes live engagement metrics from the unified posts table, and verifies viewer likes.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { communityJoin } from '@/lib/communityJoin'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'
import { getFollowingAddresses } from '@/lib/followSystem'

export const runtime = 'nodejs'

// Pinned to the current HupCommunity deployment per network — an unpinned join multiplies every
// community post by the number of deployments that chain has hosted (see lib/communityJoin.js)
const COMMUNITY_JOIN = communityJoin()

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

// --- Author cooldown (chronological discovery feeds) ---
// Posting is onchain, so nothing can rate-limit a spammer at write time — the feed has to do it
// at read time. Each author gets at most AUTHOR_BURST_CAP posts per AUTHOR_BURST_WINDOW_HOURS
// bucket and AUTHOR_DAILY_CAP per day; the overflow never enters the feed (it stays reachable on
// the author's profile and by permalink). Buckets are fixed wall-clock slices rather than a
// rolling gap so the ranking is deterministic — an offset-paginated feed whose filter depends on
// which rows preceded it would shift posts between pages.
const AUTHOR_BURST_WINDOW_HOURS = 1
const AUTHOR_BURST_CAP = 2
const AUTHOR_DAILY_CAP = 6

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
    const postType = searchParams.get('post_type')

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

    // "Premium" (bazaar) = posts with an active HupBazaar listing. Listings live onchain keyed
    // by postId with no enumeration, so this reads the store_listings discovery index, which
    // the cidex indexer maintains from ItemListed/ItemUpdated/ItemBought events. Everything
    // else — ordering, visibility rules, pagination — rides the same pipeline as the home feed.
    if (feedType === 'premium') {
      whereClause += ` AND EXISTS (
        SELECT 1 FROM store_listings sl
        WHERE sl.network_id = p.network_id AND sl.post_id = p.id AND sl.is_active = 1
      )`
    }

    // "NFT" (market) = posts carrying an active (1) or sold (2) HupTrade listing —
    // cancelled (3) stays hidden. The listing reference lives inside the post's content
    // JSON; the nft_listing_id generated column (maintained by the cidex schema)
    // materializes it so this joins against the nft_listings replay state the cidex
    // runTradeSync runner keeps current.
    if (feedType === 'nft') {
      whereClause += ` AND p.nft_listing_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM nft_listings nl
        WHERE nl.network_id = p.network_id AND nl.listing_id = p.nft_listing_id AND nl.status IN (1, 2)
      )`
    }

    // "Shorts" = posts carrying at least one video attachment. has_video is a generated column
    // (sql/2026-08-21-posts-has-video.sql) that runs the JSON walk at write time, so this stays a
    // plain indexed per-row check inside the paginated derived table rather than a scan that
    // parses every post's content on every page.
    if (feedType === 'shorts') {
      whereClause += ` AND p.has_video = 1`
    }

    // Home-tab feeds pass exclude_nft=1 so posts carrying a HupTrade NFT listing live only
    // in the dedicated NFT tab. nft_listing_id is a generated column, so the first predicate
    // is a plain per-row check inside the paginated derived table. Reposts and quotes render
    // the ORIGINAL post's listing module client-side, so the sale leaks through them too:
    // the EXISTS resolves the referenced post (is_repost holds its id; quotes keep it in
    // content.quoteOf, mirroring the nft_listing_id column's own JSON_VALUE extraction) via
    // a primary-key point lookup and hides the wrapper when the target sells an NFT.
    if (searchParams.get('exclude_nft') === '1' && feedType !== 'nft') {
      whereClause += ` AND p.nft_listing_id IS NULL AND NOT EXISTS (
        SELECT 1 FROM posts orig
        WHERE orig.network_id = p.network_id
          AND orig.id = COALESCE(
            NULLIF(p.is_repost, 0),
            CASE WHEN JSON_VALID(p.content) THEN CAST(JSON_VALUE(p.content, '$.quoteOf') AS UNSIGNED) ELSE NULL END
          )
          AND orig.nft_listing_id IS NOT NULL
      )`
    }

    // The profile splits a wallet's timeline across two tabs: `original` drops repost rows
    // (Posts), `repost` keeps only them (Reposts). Quote posts carry the author's own
    // commentary, so they stay with the originals. is_repost is NULL on a normal post, but
    // older indexed rows can hold 0 — both mean "not a repost". Living in whereClause keeps
    // the tab's meta.total count in step with the list it labels.
    if (postType === 'repost') {
      whereClause += ` AND COALESCE(p.is_repost, 0) <> 0`
    } else if (postType === 'original') {
      whereClause += ` AND COALESCE(p.is_repost, 0) = 0`
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

    // Discovery feeds (home, premium, nft) rate-limit each author so a single wallet can't own
    // the timeline. Profile timelines, community rooms and following are deliberate subscriptions
    // to one author or one room, so they stay complete; trending does its own per-author dedup.
    const applyAuthorCooldown = !walletAddress && !communityId && feedType !== 'following'

    // Paginate FIRST inside a derived table (filter + sort on the bare posts table), then join
    // back to hydrate the page. Applying whereClause directly to buildPostSelect let the
    // optimizer materialize the metric subqueries for EVERY matching post before the filesort,
    // so LIMIT never limited the work (14s unfiltered feeds in production).
    const pageSubquery = applyAuthorCooldown
      ? `SELECT pid, pnid FROM (${buildAuthorCooldownRanking(whereClause)}) ranked
         WHERE (burst_seq <= ${AUTHOR_BURST_CAP} AND day_seq <= ${AUTHOR_DAILY_CAP})
           ${viewerAddress ? `OR LOWER(pwallet) = LOWER(?)` : ''}
         ORDER BY pcreated DESC, pid DESC
         LIMIT ? OFFSET ?`
      : `SELECT p.id AS pid, p.network_id AS pnid
         FROM posts p
         ${COMMUNITY_JOIN}
         ${whereClause}
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT ? OFFSET ?`

    const query = `${buildPostSelect(viewerAddress)}
      JOIN (
        ${pageSubquery}
      ) page ON page.pid = p.id AND page.pnid = p.network_id
      ORDER BY p.created_at DESC, p.id DESC`
    // The exemption placeholder sits after the WHERE params and before LIMIT/OFFSET in the SQL text
    if (applyAuthorCooldown && viewerAddress) queryParams.push(viewerAddress)
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
         ${COMMUNITY_JOIN}
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

    // Hydrate repost rows with their original post and commented rows with their
    // newest reply, so the client renders both without per-card round trips.
    await attachRepostOriginals(postsToSend, viewerAddress)
    await attachLastComments(postsToSend, viewerAddress)

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
 * Hydrates repost rows in place with their original post under `repost_original`.
 * A repost row only carries the original's id (is_repost), so without this every
 * repost card pays an N+1 getPostById round trip after the feed paints — the
 * lone card-level shimmer in an otherwise loaded feed. One point-lookup query
 * per page, and only when the page actually contains repost rows. The select
 * mirrors the single-post route (viewer repost/bookmark state included) because
 * the embed replaces exactly that client fetch — dropping fields would regress
 * the repost menu's Undo state.
 */
async function attachRepostOriginals(rows, viewerAddress) {
  const repostRows = rows.filter((row) => Number(row.is_repost || 0) !== 0)
  if (repostRows.length === 0) return

  // Dedupe on (network, original id) — several reposts on a page can point at one post
  const pairs = [
    ...new Map(repostRows.map((row) => [`${row.network_id}:${row.is_repost}`, [row.is_repost, row.network_id]])).values(),
  ]

  const queryParams = []
  if (viewerAddress) {
    queryParams.push(viewerAddress, viewerAddress, viewerAddress, viewerAddress, viewerAddress)
  }
  pairs.forEach(([postId, networkId]) => queryParams.push(postId, networkId))

  const query = `
      SELECT
        p.*,
        u.name as display_name,
        u.profileImage as profile_image,
        n.name as network_name,
        n.explorer_url,
        comm.name as community_name,
        (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id AND network_id = p.network_id) as total_likes,
        (
          (SELECT COUNT(*) FROM posts child WHERE child.is_comment = p.id AND child.network_id = p.network_id
            AND child.contract_address <=> p.contract_address AND child.is_deleted = 0)
          + (SELECT COUNT(*) FROM posts child WHERE child.network_id = p.network_id
            AND child.contract_address <=> p.contract_address AND child.parent_id = p.id
            AND child.parent_id <> 0 AND child.is_deleted = 0
            AND NOT (child.is_comment <=> p.id)
            AND (child.content_type = 1 OR child.is_comment IS NOT NULL))
        ) as total_comments,
        (SELECT COUNT(*) FROM posts WHERE is_repost = p.id AND network_id = p.network_id AND is_deleted = 0)
        + (SELECT COUNT(*) FROM posts q WHERE q.network_id = p.network_id AND q.is_deleted = 0
           AND CASE WHEN JSON_VALID(q.content) THEN JSON_UNQUOTE(JSON_EXTRACT(q.content, '$.quoteOf')) = CAST(p.id AS CHAR) ELSE 0 END) as total_reposts,
        (SELECT COUNT(*) FROM post_views WHERE post_id = p.id AND network_id = p.network_id) as total_views,
        (SELECT COUNT(*) FROM post_bookmarks WHERE post_id = p.id AND network_id = p.network_id) as total_bookmarks,
        (SELECT COUNT(*) FROM tips WHERE post_id = p.id AND network_id = p.network_id) as total_tips,
        (SELECT COUNT(*) FROM user_reports WHERE post_id = p.id AND network_id = p.network_id AND status = 'actioned') as actioned_reports,
        ${viewerAddress ? `(SELECT EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND network_id = p.network_id AND liker_address = ?))` : '0'} as has_liked,
        ${viewerAddress ? `(SELECT EXISTS(SELECT 1 FROM post_bookmarks WHERE post_id = p.id AND network_id = p.network_id AND wallet_address = ?))` : '0'} as has_bookmarked,
        ${viewerAddress ? `(SELECT folder_id FROM post_bookmarks WHERE post_id = p.id AND network_id = p.network_id AND wallet_address = ?)` : 'NULL'} as folder_id,
        ${viewerAddress ? `(SELECT EXISTS(SELECT 1 FROM posts WHERE is_repost = p.id AND network_id = p.network_id AND wallet_address = ? AND is_deleted = 0))` : '0'} as has_reposted,
        ${viewerAddress ? `(SELECT id FROM posts WHERE is_repost = p.id AND network_id = p.network_id AND wallet_address = ? AND is_deleted = 0 LIMIT 1)` : 'NULL'} as viewer_repost_id
      FROM posts p
      LEFT JOIN users u ON p.wallet_address = u.wallet_address
      JOIN networks n ON p.network_id = n.id
      ${COMMUNITY_JOIN}
      WHERE (p.id, p.network_id) IN (${pairs.map(() => '(?, ?)').join(', ')})
  `

  const [origRows] = await pool.execute(query, queryParams)
  await fulfillUniversalProfiles(origRows, pool)

  const byKey = new Map(origRows.map((row) => [`${row.network_id}:${row.id}`, row]))
  repostRows.forEach((row) => {
    const orig = byKey.get(`${row.network_id}:${row.is_repost}`)
    if (!orig) return
    row.repost_original = {
      ...orig,
      content: parseIPFSContent(orig.content),
      has_liked: !!orig.has_liked,
      is_liked: !!orig.has_liked,
      is_bookmarked: !!orig.has_bookmarked,
      folder_id: orig.folder_id ?? null,
      has_reposted: !!orig.has_reposted,
      viewer_repost_id: orig.viewer_repost_id ?? null,
    }
  })
}

/**
 * Hydrates commented rows in place with their newest reply under `last_comment`,
 * replacing the client's per-card `comments?last=true` round trip — the preview
 * shimmer that pops in under cards after the feed paints and pushes the page
 * down. The newest reply per post is picked in a narrow window-function derived
 * table first (same paginate-then-hydrate rule as the feed query: metric
 * subqueries must only ever run on the final row set), then hydrated with the
 * comments route's exact field shape, since `PostCard` renders the embed through
 * the same `<Post>` markup the fetched row fed. A comment's feed post is
 * is_comment when set, else parent_id — mirroring the per-post route's
 * `(NULLIF(parent_id, 0) = ? OR is_comment = ?)` match.
 */
async function attachLastComments(rows, viewerAddress) {
  const commentedRows = rows.filter((row) => Number(row.total_comments) > 0)
  if (commentedRows.length === 0) return

  const pairs = [...new Map(commentedRows.map((row) => [`${row.network_id}:${row.id}`, [row.id, row.network_id]])).values()]

  // Newest reply per post via one UNION ALL of per-post point lookups — each
  // branch is the per-post comments route's own predicate and ORDER BY ... LIMIT 1,
  // so it rides the same indexes. (A ROW_NUMBER() OVER a tuple-IN-on-expression
  // derived table looked cleaner but is exactly the kind of exotic plan this
  // XAMPP MariaDB 10.4 build crashes on.)
  const pickParams = []
  const pickQuery = pairs
    .map(([postId, networkId]) => {
      pickParams.push(postId, networkId, postId, postId)
      return `(SELECT c.id, c.network_id, ? AS last_comment_of
        FROM posts c
        WHERE c.network_id = ?
          AND c.is_deleted = 0
          AND (c.content_type = 1 OR c.is_comment IS NOT NULL)
          AND (NULLIF(c.parent_id, 0) = ? OR c.is_comment = ?)
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT 1)`
    })
    .join(' UNION ALL ')

  const [pickRows] = await pool.execute(pickQuery, pickParams)
  if (pickRows.length === 0) return

  const queryParams = []
  if (viewerAddress) {
    queryParams.push(viewerAddress)
  }
  pickRows.forEach((row) => queryParams.push(row.id, row.network_id))

  const query = `
      SELECT
        p.*,
        u.name as display_name,
        u.profileImage as profile_image,
        n.name as network_name,
        n.explorer_url,
        (
          SELECT COUNT(*)
          FROM post_likes pl
          WHERE pl.post_id = p.id
            AND pl.network_id = p.network_id
            AND pl.contract_address <=> p.contract_address
            AND pl.is_active = 1
        ) as total_likes,
        (
          (SELECT COUNT(*) FROM posts child WHERE child.is_comment = p.id AND child.network_id = p.network_id
            AND child.contract_address <=> p.contract_address AND child.is_deleted = 0)
          + (SELECT COUNT(*) FROM posts child WHERE child.network_id = p.network_id
            AND child.contract_address <=> p.contract_address AND child.parent_id = p.id
            AND child.parent_id <> 0 AND child.is_deleted = 0
            AND NOT (child.is_comment <=> p.id)
            AND (child.content_type = 1 OR child.is_comment IS NOT NULL))
        ) as total_comments,
        (SELECT COUNT(*) FROM posts reposter WHERE reposter.network_id = p.network_id
          AND reposter.is_deleted = 0 AND reposter.is_repost = p.id)
        + (SELECT COUNT(*) FROM posts q WHERE q.network_id = p.network_id AND q.is_deleted = 0
           AND CASE WHEN JSON_VALID(q.content) THEN JSON_UNQUOTE(JSON_EXTRACT(q.content, '$.quoteOf')) = CAST(p.id AS CHAR) ELSE 0 END) as total_reposts,
        (SELECT COUNT(*) FROM post_views pv WHERE pv.post_id = p.id AND pv.network_id = p.network_id) as total_views,
        ${viewerAddress ? `(
          SELECT EXISTS(
            SELECT 1
            FROM post_likes pl
            WHERE pl.post_id = p.id
              AND pl.network_id = p.network_id
              AND pl.contract_address <=> p.contract_address
              AND pl.liker_address = ?
              AND pl.is_active = 1
          )
        )` : '0'} as has_liked
      FROM posts p
      LEFT JOIN users u ON p.wallet_address = u.wallet_address
      JOIN networks n ON p.network_id = n.id
      WHERE (p.id, p.network_id) IN (${pickRows.map(() => '(?, ?)').join(', ')})
  `

  const [commentRows] = await pool.execute(query, queryParams)
  await fulfillUniversalProfiles(commentRows, pool)

  // pick told us which post each comment previews; the hydrated rows carry ids only
  const parentOf = new Map(pickRows.map((row) => [`${row.network_id}:${row.id}`, row.last_comment_of]))
  const byParent = new Map(commentRows.map((row) => [`${row.network_id}:${parentOf.get(`${row.network_id}:${row.id}`)}`, row]))
  commentedRows.forEach((row) => {
    const match = byParent.get(`${row.network_id}:${row.id}`)
    if (!match) return
    row.last_comment = {
      ...match,
      is_liked: Boolean(match.has_liked),
      content: parseIPFSContent(match.content),
    }
  })
}

/**
 * Ranks every post the feed filter matches by its position inside its author's time bucket, so
 * the caller can keep only the first few. Partitioning on the wallet alone (not wallet+network)
 * makes the cap cross-chain: reposting the same thing on nine networks is one author flooding one
 * feed. LOWER() because cidex writes checksummed addresses into binary-collated columns, so the
 * same wallet can differ in case between rows. Selects only the narrow columns the outer
 * pagination needs — the heavy metric subqueries still run on the final page slice alone.
 */
function buildAuthorCooldownRanking(whereClause) {
  // Buckets are cut from the stored DATETIME itself (DATE + HOUR), never UNIX_TIMESTAMP: that
  // function reads a DATETIME through the *session* time zone, so the same row would fall in
  // different buckets depending on the connection's TZ and would drift across a DST change.
  return `
        SELECT
          p.id AS pid,
          p.network_id AS pnid,
          p.created_at AS pcreated,
          p.wallet_address AS pwallet,
          ROW_NUMBER() OVER (
            PARTITION BY LOWER(p.wallet_address), DATE(p.created_at), FLOOR(HOUR(p.created_at) / ${AUTHOR_BURST_WINDOW_HOURS})
            ORDER BY p.created_at DESC, p.id DESC
          ) AS burst_seq,
          ROW_NUMBER() OVER (
            PARTITION BY LOWER(p.wallet_address), DATE(p.created_at)
            ORDER BY p.created_at DESC, p.id DESC
          ) AS day_seq
        FROM posts p
        ${COMMUNITY_JOIN}
        ${whereClause}
  `
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
        (
          (SELECT COUNT(*) FROM posts child WHERE child.is_comment = p.id AND child.network_id = p.network_id
            AND child.contract_address <=> p.contract_address AND child.is_deleted = 0)
          + (SELECT COUNT(*) FROM posts child WHERE child.network_id = p.network_id
            AND child.contract_address <=> p.contract_address AND child.parent_id = p.id
            AND child.parent_id <> 0 AND child.is_deleted = 0
            AND NOT (child.is_comment <=> p.id)
            AND (child.content_type = 1 OR child.is_comment IS NOT NULL))
        ) as total_comments,
        (SELECT COUNT(*) FROM posts WHERE is_repost = p.id AND network_id = p.network_id AND is_deleted = 0)
        + (SELECT COUNT(*) FROM posts q WHERE q.network_id = p.network_id AND q.is_deleted = 0
           AND CASE WHEN JSON_VALID(q.content) THEN JSON_UNQUOTE(JSON_EXTRACT(q.content, '$.quoteOf')) = CAST(p.id AS CHAR) ELSE 0 END) as total_reposts,
        (SELECT COUNT(*) FROM post_views WHERE post_id = p.id AND network_id = p.network_id) as total_views,
        (SELECT COUNT(*) FROM post_bookmarks WHERE post_id = p.id AND network_id = p.network_id) as total_bookmarks,
        (SELECT COUNT(*) FROM tips WHERE post_id = p.id AND network_id = p.network_id) as total_tips,
        (SELECT COUNT(*) FROM user_reports WHERE post_id = p.id AND network_id = p.network_id AND status = 'actioned') as actioned_reports,
        ${viewerAddress ? `(SELECT EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND network_id = p.network_id AND liker_address  = ?))` : '0'} as has_liked,
        ${viewerAddress ? `(SELECT EXISTS(SELECT 1 FROM post_bookmarks WHERE post_id = p.id AND network_id = p.network_id AND wallet_address = ?))` : '0'} as has_bookmarked
      FROM posts p
      LEFT JOIN users u ON p.wallet_address = u.wallet_address
      JOIN networks n ON p.network_id = n.id
      ${COMMUNITY_JOIN}
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
  await attachRepostOriginals(orderedPosts, viewerAddress)
  await attachLastComments(orderedPosts, viewerAddress)

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
    ${COMMUNITY_JOIN}
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
/**
 * @file lib/postRows.js
 * @description One post row with its counters, read straight from the indexed tables.
 *
 * The post API route and the post page share this read. The route decorates the row for a
 * viewer (liked/bookmarked flags, Universal Profile fill, tip and sale dollars) and answers the
 * client's background refresh; the page reads the bare row so the post itself is in the first
 * bytes of HTML — the way X serves a tweet before its replies — and leaves everything that needs
 * a wallet, a chain read or a price feed to that refresh.
 */
import { unstable_cache } from 'next/cache'
import pool from '@/lib/db'
import { communityJoin } from '@/lib/communityJoin'
import { hasColumn } from '@/lib/schema'

// How long a shared link can be served from the same row. Counters on the page are corrected
// by the client's own refresh right after hydration, so this only absorbs bursts.
const PAGE_ROW_REVALIDATE_SECONDS = 30

// Thrown inside the cached read so a miss is never stored: a link shared the moment a post is
// sent must pick the row up on the very next request, not after the revalidate window.
const MISSING_ROW = 'post-row-missing'

/**
 * Helper to safely handle IPFS JSON data stored in the DB.
 */
function parseContent(content) {
  try {
    return JSON.parse(content)
  } catch (e) {
    return content
  }
}

/**
 * The raw row as the query returns it — content still a JSON string, viewer flags as 0/1 — or
 * null when the post does not exist on that network.
 *
 * total_reposts merges true reposts and quotes (X-style); quotes are matched via the quoteOf key
 * in their content JSON, so quotes sealed inside encrypted communities cannot be counted.
 * @param {string|number} networkId
 * @param {string|number} postId
 * @param {string|null} [viewerAddress] Makes the query compute has_liked/has_bookmarked/
 *   folder_id/has_reposted/viewer_repost_id for that wallet.
 * @returns {Promise<Object|null>}
 */
export async function readPostRow(networkId, postId, viewerAddress = null) {
  const queryParams = [postId, networkId]
  if (viewerAddress) {
    // Prepend the viewer address for each dynamic has_liked/has_bookmarked/folder_id/has_reposted/viewer_repost_id subquery position
    queryParams.unshift(viewerAddress, viewerAddress, viewerAddress, viewerAddress, viewerAddress)
  }

  // The handle rides along with the name so a byline painted from this row reads the same as the
  // fetched profile will. Probed rather than assumed: the column arrives by hand-run migration.
  const usernameColumn = (await hasColumn('users', 'username')) ? 'u.username as username,' : ''

  const query = `
    SELECT
      p.*,
      n.name as network_name,
      n.id as network_id,
      u.name as display_name,
      u.profileImage as profile_image,
      ${usernameColumn}
      comm.name as community_name,
      (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id AND network_id = p.network_id AND is_active = 1) as total_likes,
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
      ${viewerAddress ? `(SELECT EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND network_id = p.network_id AND liker_address = ? AND is_active = 1))` : '0'} as has_liked,
      ${viewerAddress ? `(SELECT EXISTS(SELECT 1 FROM post_bookmarks WHERE post_id = p.id AND network_id = p.network_id AND wallet_address = ?))` : '0'} as has_bookmarked,
      ${viewerAddress ? `(SELECT folder_id FROM post_bookmarks WHERE post_id = p.id AND network_id = p.network_id AND wallet_address = ?)` : 'NULL'} as folder_id,
      ${viewerAddress ? `(SELECT EXISTS(SELECT 1 FROM posts WHERE is_repost = p.id AND network_id = p.network_id AND wallet_address = ? AND is_deleted = 0))` : '0'} as has_reposted,
      ${viewerAddress ? `(SELECT id FROM posts WHERE is_repost = p.id AND network_id = p.network_id AND wallet_address = ? AND is_deleted = 0 LIMIT 1)` : 'NULL'} as viewer_repost_id
    FROM posts p
    JOIN networks n ON p.network_id = n.id
    LEFT JOIN users u ON p.wallet_address = u.wallet_address
    ${communityJoin()}
    WHERE p.id = ? AND n.id = ?
    LIMIT 1
  `

  const [rows] = await pool.execute(query, queryParams)
  return rows[0] ?? null
}

/**
 * The row as the API emits it: content parsed, viewer flags as booleans. Feed rows expose the
 * viewer flag as is_liked; consumers (e.g. the Like button's initial state) read that name, so
 * the detail row carries both.
 * @param {Object} post A row from readPostRow, decorated or not.
 * @returns {Object}
 */
export function shapePostRow(post) {
  return {
    ...post,
    content: parseContent(post.content),
    has_liked: !!post.has_liked,
    is_liked: !!post.has_liked,
    is_bookmarked: !!post.has_bookmarked,
    folder_id: post.folder_id ?? null,
    has_reposted: !!post.has_reposted,
    viewer_repost_id: post.viewer_repost_id ?? null,
  }
}

// JSON round trip so a cache hit (deserialized) and a cache miss (live mysql2 row, Date objects
// and all) hand the page the identical shape the API route serializes.
const readPageRow = unstable_cache(
  async (networkId, postId) => {
    const row = await readPostRow(networkId, postId, null)
    if (!row) throw new Error(MISSING_ROW)
    const post = shapePostRow(row)

    // A repost is a frame around another post, and the card paints a skeleton until it has that
    // one — embedded here the way the feed embeds it, so the page carries both
    if (Number(post.is_repost) > 0) {
      const original = await readPostRow(networkId, post.is_repost, null)
      post.repost_original = original ? shapePostRow(original) : null
    }

    return JSON.parse(JSON.stringify(post))
  },
  ['post-page-row'],
  { revalidate: PAGE_ROW_REVALIDATE_SECONDS },
)

/**
 * The anonymous row the post page renders on the server, or null when there is no such post. No
 * viewer, no chain read, no price lookup — those ride on the client's refresh — so the post can
 * stream with the shell.
 * @param {string|number} networkId
 * @param {string|number} postId
 * @returns {Promise<Object|null>}
 */
export async function readPostForPage(networkId, postId) {
  try {
    return await readPageRow(String(networkId), String(postId))
  } catch (error) {
    if (error?.message === MISSING_ROW) return null
    throw error
  }
}

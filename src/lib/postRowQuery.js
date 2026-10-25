/**
 * @file lib/postRowQuery.js
 * @description The SELECT a reply-shaped post row is read with: the row, its author's cached
 * profile, its network, and the counters a card renders (likes, replies, reposts, views), plus
 * whether the viewer liked it. Shared by the comments route and the thread route so a thread
 * part and a reply are the same row on screen.
 */

/**
 * @param {boolean} withViewer Adds `has_liked`; the caller then passes the viewer's address as
 *   the first query parameter.
 * @returns {string} `SELECT … FROM posts p …` ready for a WHERE clause.
 */
export const postRowSelect = (withViewer) => `
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
    (
      SELECT COUNT(*)
      FROM posts reposter
      WHERE reposter.network_id = p.network_id
        AND reposter.is_deleted = 0
        AND reposter.is_repost = p.id
    ) + (
      SELECT COUNT(*)
      FROM posts q
      WHERE q.network_id = p.network_id
        AND q.is_deleted = 0
        AND CASE WHEN JSON_VALID(q.content) THEN JSON_UNQUOTE(JSON_EXTRACT(q.content, '$.quoteOf')) = CAST(p.id AS CHAR) ELSE 0 END
    ) as total_reposts,
    (
      SELECT COUNT(*)
      FROM post_views pv
      WHERE pv.post_id = p.id
        AND pv.network_id = p.network_id
    ) as total_views,
    ${withViewer ? `(
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
`

/**
 * Content is stored as the pinned JSON string; a row that isn't JSON passes through as-is.
 * @param {string} content
 */
export const parsePostContent = (content) => {
  try {
    return JSON.parse(content)
  } catch {
    return content
  }
}

/**
 * @file api/v1/networks/posts/bookmarked/route.js
 * @description Fetches the full post rows a wallet has bookmarked, newest saved first, in the same shape as the main feed so it can be rendered with the existing Post component.
 */
import { NextResponse } from 'next/server'
import { isWalletAddress } from '@/lib/address'
import pool from '@/lib/db'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'

export const runtime = 'nodejs'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const walletAddress = searchParams.get('wallet_address') || searchParams.get('address')

    if (!isWalletAddress(walletAddress)) {
      return NextResponse.json({ success: false, error: 'Valid wallet address is required' }, { status: 400 })
    }

    const page = clampNumber(parseInt(searchParams.get('page'), 10), 1, 1000, 1)
    const limit = clampNumber(parseInt(searchParams.get('limit'), 10), 1, MAX_LIMIT, DEFAULT_LIMIT)
    const offset = (page - 1) * limit
    const folderId = searchParams.get('folder_id')
    const searchTerm = searchParams.get('q')
    const queryParams = [walletAddress, walletAddress]
    let folderClause = ''
    let searchClause = ''

    if (folderId) {
      folderClause = 'AND b.folder_id = ?'
      queryParams.push(folderId)
    }

    if (searchTerm) {
      searchClause = 'AND p.content LIKE ?'
      queryParams.push(`%${searchTerm}%`)
    }

    const query = `
      SELECT
        p.*,
        u.name as display_name,
        u.profileImage as profile_image,
        n.name as network_name,
        n.explorer_url,
        b.created_at as bookmarked_at,
        b.folder_id as folder_id,
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
        (SELECT COUNT(*) FROM post_views WHERE post_id = p.id AND network_id = p.network_id) as total_views,
        (SELECT COUNT(*) FROM post_bookmarks WHERE post_id = p.id AND network_id = p.network_id) as total_bookmarks,
        (SELECT COUNT(*) FROM user_reports WHERE post_id = p.id AND network_id = p.network_id AND status = 'actioned') as actioned_reports,
        (SELECT EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND network_id = p.network_id AND liker_address = ? AND is_active = 1)) as has_liked
      FROM post_bookmarks b
      JOIN posts p ON p.id = b.post_id AND p.network_id = b.network_id
      LEFT JOIN users u ON p.wallet_address = u.wallet_address
      JOIN networks n ON p.network_id = n.id
      WHERE b.wallet_address = ? AND p.is_deleted = 0 ${folderClause} ${searchClause}
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT ? OFFSET ?
    `

    queryParams.push(limit + 1, offset)
    const [rows] = await pool.execute(query, queryParams)

    const hasMore = rows.length > limit
    const postsToSend = hasMore ? rows.slice(0, limit) : rows

    // Counted on the first page only - it feeds a single header line ("128 saved", "9 results"),
    // so repeating the COUNT on every scroll page would buy nothing the UI reads.
    let total = null
    if (page === 1) {
      const countParams = [walletAddress]
      if (folderId) countParams.push(folderId)
      if (searchTerm) countParams.push(`%${searchTerm}%`)

      const [countRows] = await pool.execute(
        `SELECT COUNT(*) AS total
         FROM post_bookmarks b
         JOIN posts p ON p.id = b.post_id AND p.network_id = b.network_id
         WHERE b.wallet_address = ? AND p.is_deleted = 0 ${folderClause} ${searchClause}`,
        countParams
      )
      total = Number(countRows[0]?.total) || 0
    }

    await fulfillUniversalProfiles(postsToSend, pool)

    return NextResponse.json({
      success: true,
      data: postsToSend.map((post) => ({
        ...post,
        is_liked: Boolean(post.has_liked),
        is_bookmarked: true,
        content: parseIPFSContent(post.content),
      })),
      nextPage: hasMore ? page + 1 : null,
      meta: {
        page,
        count: postsToSend.length,
        hasMore,
        total,
      },
    })
  } catch (error) {
    console.error('[BOOKMARKED_POSTS_FETCH_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to fetch saved posts' }, { status: 500 })
  }
}


function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

function parseIPFSContent(content) {
  try {
    return JSON.parse(content)
  } catch (e) {
    return content
  }
}

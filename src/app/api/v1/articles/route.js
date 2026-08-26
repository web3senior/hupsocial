/**
 * @file api/v1/articles/route.js
 * @description Lists long-form articles. An article is an ordinary post whose content JSON
 * carries an `article` reference (see lib/article), so there is no articles table and nothing
 * for cidex to index separately — this reads the same `posts` rows the feed does and pulls the
 * card fields out of the JSON.
 *
 * Only the card is selected, never `p.content` wholesale: the body already lives under its own
 * CID and the rest of the payload (media items, cashtags, other attachments) is nothing a
 * directory needs. That keeps a page of 24 articles roughly the size of a page of posts.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

/* The card fields, lifted out of the content JSON. JSON_VALUE returns scalars; tags are an array
   so they come back through JSON_EXTRACT as JSON text and are parsed below. */
const ARTICLE_COLUMNS = `
  p.id,
  p.network_id,
  p.wallet_address,
  p.created_at,
  JSON_VALUE(p.content, '$.article.title') AS title,
  JSON_VALUE(p.content, '$.article.subtitle') AS subtitle,
  JSON_VALUE(p.content, '$.article.excerpt') AS excerpt,
  JSON_VALUE(p.content, '$.article.cover') AS cover,
  JSON_VALUE(p.content, '$.article.bodyCid') AS bodyCid,
  JSON_VALUE(p.content, '$.article.wordCount') AS wordCount,
  JSON_EXTRACT(p.content, '$.article.tags') AS tags,
  n.name AS network_name`

/* No author name or avatar here on purpose. The directory renders its byline through the shared
   Profile component, which resolves the author from the address on its own (useProfile) and puts
   every picture through resolveAvatarImageUrl. Selecting them here would join `users` and call
   the LUKSO endpoint on every request to produce fields nothing reads — and would be a second
   place for an author's name to come from, which is exactly how the two drift apart. */

/* What makes a row an article at all. Repeated in app/sitemap.js — both are scans of the same
   shape, and a post without a bodyCid has no body to read. */
const IS_ARTICLE = `p.is_deleted = 0 AND JSON_VALID(p.content) AND JSON_VALUE(p.content, '$.article.bodyCid') IS NOT NULL`

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)

    const networkId = parseInt(searchParams.get('networkId')) || null
    const author = (searchParams.get('author') || '').trim().toLowerCase() || null
    const tag = (searchParams.get('tag') || '').trim().slice(0, 40).toLowerCase() || null
    const q = (searchParams.get('q') || '').trim().slice(0, 100) || null
    const page = Math.max(parseInt(searchParams.get('page')) || 1, 1)
    const limit = Math.min(parseInt(searchParams.get('limit')) || 24, 50)
    const offset = (page - 1) * limit

    const filters = []
    const args = []

    if (networkId) {
      filters.push('AND p.network_id = ?')
      args.push(networkId)
    }
    if (author) {
      filters.push('AND LOWER(p.wallet_address) = ?')
      args.push(author)
    }
    if (tag) {
      /* Tags are stored lowercased by the editor, so a plain containment test is enough and
         avoids a per-row JSON_TABLE join. */
      filters.push(`AND JSON_CONTAINS(JSON_EXTRACT(p.content, '$.article.tags'), JSON_QUOTE(?))`)
      args.push(tag)
    }
    if (q) {
      filters.push(`AND (JSON_VALUE(p.content, '$.article.title') LIKE ? OR JSON_VALUE(p.content, '$.article.excerpt') LIKE ?)`)
      args.push(`%${q}%`, `%${q}%`)
    }

    const where = `WHERE ${IS_ARTICLE} ${filters.join(' ')}`

    const [rows] = await pool.execute(
      `SELECT ${ARTICLE_COLUMNS}
       FROM posts p
       JOIN networks n ON p.network_id = n.id
       ${where}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      args
    )

    const articles = rows.map((row) => ({
      ...row,
      wordCount: Number(row.wordCount) || 0,
      /* MariaDB hands JSON_EXTRACT back as text; a malformed value degrades to no tags rather
         than taking the whole listing down. */
      tags: (() => {
        if (Array.isArray(row.tags)) return row.tags
        try {
          const parsed = JSON.parse(row.tags || '[]')
          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      })(),
    }))

    return NextResponse.json({
      success: true,
      data: articles,
      meta: { page, limit, count: articles.length, hasMore: articles.length === limit },
    })
  } catch (error) {
    console.error('[api/v1/articles] list failed:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to load articles' }, { status: 500 })
  }
}

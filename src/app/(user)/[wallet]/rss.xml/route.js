import { getProfile } from '@/lib/api'
import { isWalletAddress, normalizeAddress, shortAddress } from '@/lib/address'
import pool from '@/lib/db'
import { communityJoin } from '@/lib/communityJoin'
import { summarizePost } from '@/lib/postSummary'

/**
 * @file (user)/[wallet]/rss.xml/route.js
 * @description One account's latest posts as an RSS 2.0 feed, so it can be followed from any
 * feed reader without a wallet or an account.
 *
 * Readers poll on their own schedule, every 15 to 60 minutes, and a popular account has many of
 * them. The cache window below is what keeps that cheap: one run per feed per window, however
 * many readers ask.
 */

export const revalidate = 900

const FEED_POST_LIMIT = 20

/* The whole thought for nearly every post; the link carries the rest. */
const POST_TEXT_MAX = 1000

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || 'https://hup.social').replace(/\/$/, '')

const COMMUNITY_JOIN = communityJoin()

/* XML 1.0 has no escape for control characters or lone surrogates; one of them in a post would
   make every reader reject the whole feed, so they are dropped rather than escaped. */
const isXmlChar = (code) =>
  code === 0x9 || code === 0xa || code === 0xd || (code >= 0x20 && !(code >= 0xd800 && code <= 0xdfff) && code !== 0xfffe && code !== 0xffff)

const XML_ENTITIES = { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }

function xml(value) {
  return Array.from(String(value ?? ''))
    .filter((char) => isXmlChar(char.codePointAt(0)))
    .join('')
    .replace(/[<>&'"]/g, (char) => XML_ENTITIES[char])
}

function oneLine(text) {
  return (text || '').replace(/\s+/g, ' ').trim()
}

/**
 * The posts the profile's own Posts tab shows a signed-out visitor: originals and quotes, no
 * comments or reposts, and community posts only from open, unencrypted communities. A feed is
 * public the moment its URL is shared, so it never gets the wider member view.
 */
async function fetchPosts(address) {
  try {
    const [rows] = await pool.execute(
      `SELECT p.id, p.network_id, p.created_at, p.content, p.nft_listing_id, p.moderation_flagged,
         (SELECT COUNT(*) FROM user_reports r
           WHERE r.post_id = p.id AND r.network_id = p.network_id AND r.status = 'actioned') AS actioned_reports
       FROM posts p
       JOIN (
         SELECT p.id AS pid, p.network_id AS pnid
         FROM posts p
         ${COMMUNITY_JOIN}
         WHERE p.wallet_address = ? AND p.is_deleted = 0 AND p.is_comment IS NULL
           AND COALESCE(p.is_repost, 0) = 0
           AND (p.community_id IS NULL OR (comm.membership_type = 0 AND comm.is_encrypted = 0))
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT ${FEED_POST_LIMIT}
       ) page ON page.pid = p.id AND page.pnid = p.network_id
       ORDER BY p.created_at DESC, p.id DESC`,
      [address],
    )
    return rows
  } catch (error) {
    console.error('[profile rss.xml] could not read posts:', error.message)
    return null
  }
}

function notFound() {
  return new Response('Profile not found\n', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

function renderItem(row, authorName) {
  let content = row.content
  try {
    content = JSON.parse(row.content)
  } catch {
    /* A body that never parsed is a body summarizePost will describe instead of quote. */
  }

  const url = `${BASE_URL}/networks/${row.network_id}/${row.id}`

  /* The app veils these until the viewer taps through; a reader has no veil, so it gets the
     link instead of the words. */
  const isVeiled = Number(row.moderation_flagged || 0) === 1 || Number(row.actioned_reports || 0) >= 3
  const text = isVeiled
    ? 'This post is behind a content warning. Open it on Hup to view it.'
    : summarizePost({ ...row, content, display_name: authorName }, POST_TEXT_MAX)

  return [
    '    <item>',
    `      <link>${xml(url)}</link>`,
    `      <guid isPermaLink="true">${xml(url)}</guid>`,
    row.created_at ? `      <pubDate>${new Date(row.created_at).toUTCString()}</pubDate>` : null,
    `      <description>${xml(text)}</description>`,
    '    </item>',
  ]
    .filter(Boolean)
    .join('\n')
}

export async function GET(request, { params }) {
  const { wallet } = await params

  let response = null
  try {
    response = await getProfile(wallet)
  } catch (error) {
    console.error('[profile rss.xml] profile fetch failed:', error.message)
  }

  const profile = response?.data ?? null
  if (!profile) return notFound()

  const address = normalizeAddress(profile.wallet_address || wallet)
  if (!isWalletAddress(address)) return notFound()

  const posts = await fetchPosts(address)
  if (posts === null) {
    /* A 500 here would be cached by readers as "feed is gone"; a short-lived 503 is a retry. */
    return new Response('Feed temporarily unavailable\n', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '900' },
    })
  }

  /* Loading a profile writes its users row, so nearly every address ever viewed has a blank
     one. Without this, any address in existence would answer with an empty feed. */
  const bio = oneLine(profile.description)
  if (!profile.username && !profile.name && !bio && posts.length === 0) return notFound()

  const name = profile.name || shortAddress(address)
  const profilePath = profile.username ? `/@${profile.username}` : `/${address}`
  const feedUrl = `${BASE_URL}${profilePath}/rss.xml`
  const title = profile.username ? `${name} (@${profile.username}) on Hup` : `${name} on Hup`
  const newest = posts[0]?.created_at ? new Date(posts[0].created_at) : null

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${xml(title)}</title>`,
    `    <link>${xml(`${BASE_URL}${profilePath}`)}</link>`,
    `    <description>${xml(bio || `The latest posts from ${name} on Hup.`)}</description>`,
    `    <atom:link href="${xml(feedUrl)}" rel="self" type="application/rss+xml" />`,
    '    <generator>Hup</generator>',
    /* Minutes. Asks readers not to poll faster than the cache refreshes anyway. */
    '    <ttl>15</ttl>',
    newest ? `    <lastBuildDate>${newest.toUTCString()}</lastBuildDate>` : null,
    ...posts.map((row) => renderItem(row, name)),
    '  </channel>',
    '</rss>',
    '',
  ].filter((line) => line !== null)

  return new Response(lines.join('\n'), {
    headers: {
      /* Not application/rss+xml: browsers download that instead of showing it, and readers accept both. */
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=900, s-maxage=900, stale-while-revalidate=3600',
    },
  })
}

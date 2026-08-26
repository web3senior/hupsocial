/**
 * @file app/api/v1/cron/notification-emails/route.js
 * @description Sweeps pending notifications into per-recipient digest emails.
 *
 * cidex (and the few in-app writers) insert notification rows with
 * email_status='pending' by column default; this sweeper is the only thing
 * that talks SMTP, keeping the "indexers index, the app delivers" split. Each
 * run sends AT MOST one email per recipient regardless of how many rows are
 * pending — a viral post becomes one digest, not a hundred messages.
 *
 * Not every notification is worth an inbox: only the action types in
 * EMAIL_WORTHY_TYPES are mailed. Rows for recipients with no verified, enabled
 * email are marked skipped alongside them, so the pending set never grows
 * unbounded.
 *
 * Replies and quotes carry their text into the email (SNIPPET_SOURCE): "X
 * commented on your post." alone withholds the one thing the recipient opened
 * the mail for.
 *
 * Vercel cron GETs this path with `Authorization: Bearer ${CRON_SECRET}`
 * (vercel.json); locally the same curl works.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { getMediaItems, getText } from '@/lib/content'
import { sendNotificationDigest } from '@/lib/mailer'
import { resolveAvatarImageUrl } from '@/lib/storageHelper'

// Serverless-budget caps: recipients per run, rows fetched per run, and lines
// actually listed in one digest (the rest is folded into "+N more").
const MAX_RECIPIENTS = 50
const MAX_ROWS = 500
const MAX_LISTED = 10

/* The slot the digest template draws an actor at. Sized rather than given a width so it lands on
   the same ladder rung the app itself uses — the picture is usually already encoded and cached by
   the time a digest goes out. */
const DIGEST_AVATAR_SIZE = 32

/* The one surface that asks for a frozen frame, and not to save an encode: an animation is
   wasted on the mail clients that refuse to play one, and worse than wasted on the ones that
   show its last frame instead of its first. */
const DIGEST_AVATAR_OPTIONS = { still: true }

// Quoted reply text is a preview, not the post — long enough to carry a real
// sentence, short enough that ten of them stay one scroll.
const MAX_SNIPPET = 140

/**
 * The only action types that reach an inbox. Two kinds of row are deliberately
 * absent:
 *   - your own activity ("You liked a post", "Your post was indexed") — cidex
 *     writes those with actor = recipient and the app files them under the
 *     "You" tab; mailing them is mailing someone their own clicks;
 *   - likes ("… liked your post") — by far the highest-volume notification and
 *     the lowest signal, so they stay in the app only.
 * The list fails closed: an action type cidex starts writing later is skipped
 * until it is added here, which is the safe direction for email.
 * community_vault_needed is the one self-actor row that made the cut — it is an
 * actionable "unlock your Security Vault" alert, not an echo of something you did.
 */
const EMAIL_WORTHY_TYPES = [
  'post_received_comment',
  'post_received_quote',
  'post_received_repost',
  'user_received_follow',
  'post_received_tip',
  'nft_sold',
  'nft_offer_received',
  'nft_offer_filled',
  'market_received_bet',
  'market_resolved',
  'market_refunds_available',
  'market_judge_invited',
  'market_judge_accepted',
  'community_member_joined',
  'community_join_requested',
  'community_vault_needed',
  'followed_user_created_community',
]

const WORTHY_PLACEHOLDERS = EMAIL_WORTHY_TYPES.map(() => '?').join(', ')

/**
 * Action types whose line is worth quoting a post under, mapped to the `data`
 * key holding that post's id — the same child-post resolution the in-app feed
 * does through `previewFrom: 'child'`. Only replies and quotes qualify: a like
 * or a repost adds no words, and the post they point at is the recipient's own.
 */
const SNIPPET_SOURCE = {
  post_received_comment: 'comment_post_id',
  post_received_quote: 'quote_post_id',
}

const shortWallet = (wallet) => `${wallet.slice(0, 6)}...${wallet.slice(-4)}`

const parseJson = (value) => {
  if (!value) return null
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/**
 * Builds the digest line for one notification row. cidex copy leads with a
 * short wallet label ("0x1234...abcd replied to your post.") because that is
 * all an indexer knows; at send time the actor's current profile is one join
 * away, so the label is upgraded to their display name. Case-insensitive prefix
 * match: cidex shortens the checksummed event address while the column may
 * store lowercase.
 * @param {object} row - Notification row joined with the actor's users row.
 * @returns {string} Line copy for the email.
 */
const digestLine = (row) => {
  const line = row.message || row.title
  if (!row.actor_wallet_address || !row.actor_name) return line
  const short = shortWallet(row.actor_wallet_address)
  if (!line.toLowerCase().startsWith(short.toLowerCase())) return line
  return `${row.actor_name}${line.slice(short.length)}`
}

/** Post ids repeat across networks and across contracts on one network — key on all three. */
const postKey = (postId, networkId, contractAddress) => `${postId}:${networkId}:${(contractAddress || '').toLowerCase()}`

/**
 * The post whose text belongs under a row's line: the reply or quote itself,
 * never the post it answers (the recipient wrote that one).
 * @param {object} row - Notification row.
 * @returns {{postId: string, networkId: number|string, contractAddress: string|null}|null}
 */
const snippetRef = (row) => {
  const key = SNIPPET_SOURCE[row.action_type]
  if (!key) return null

  const data = parseJson(row.data)
  const postId = data?.[key]
  const networkId = data?.network_id ?? row.network_id
  if (!postId || !networkId) return null

  return { postId: String(postId), networkId, contractAddress: data?.contract_address || null }
}

/**
 * Plain-text preview of a post's stored metadata: its text, or a media summary
 * for a wordless reply. Community posts sealed by a vault parse to an
 * `encrypted` envelope with no elements — those stay unquoted rather than
 * shipping ciphertext to an inbox.
 * @param {string|object|null} content - Raw `posts.content` value.
 * @returns {string|null} Snippet, or null when there is nothing to show.
 */
const postSnippet = (content) => {
  const parsed = parseJson(content)
  if (!parsed || parsed.encrypted) return null

  const text = getText(parsed).trim()
  if (text) return text.length > MAX_SNIPPET ? `${text.slice(0, MAX_SNIPPET).trim()}…` : text

  const items = getMediaItems(parsed)
  if (items.length === 0) return null

  const hasImage = items.some((item) => item?.type === 'image')
  const hasVideo = items.some((item) => item?.type === 'video')
  if (hasImage && hasVideo) return '📷🎥 Media'
  if (hasVideo) return items.length > 1 ? `🎥 ${items.length} videos` : '🎥 Video'
  return items.length > 1 ? `📷 ${items.length} photos` : '📷 Photo'
}

/**
 * One batched posts read for every reply and quote this sweep will list.
 * Deleted and moderation-flagged posts are excluded in SQL: the app hides those
 * behind a blur the reader can choose to lift, and an email cannot.
 * @param {Array<object|null>} refs - Refs from snippetRef, nulls included.
 * @returns {Promise<Map<string, string>>} postKey -> snippet.
 */
const fetchSnippets = async (refs) => {
  const unique = new Map()
  for (const ref of refs) {
    if (ref) unique.set(postKey(ref.postId, ref.networkId, ref.contractAddress), ref)
  }
  if (unique.size === 0) return new Map()

  // Matched on (id, network) alone — the PK prefix — and disambiguated by
  // contract in the map below. posts.contract_address is ascii_bin, so a SQL
  // comparison against a differently-cased address would silently match nothing.
  const clauses = []
  const params = []
  for (const ref of unique.values()) {
    clauses.push('(id = ? AND network_id = ?)')
    params.push(ref.postId, ref.networkId)
  }

  const [rows] = await pool.execute(
    `SELECT id, network_id, contract_address, content FROM posts
     WHERE is_deleted = 0 AND moderation_flagged = 0 AND (${clauses.join(' OR ')})`,
    params,
  )

  const snippets = new Map()
  for (const row of rows) {
    const snippet = postSnippet(row.content)
    if (!snippet) continue

    snippets.set(postKey(row.id, row.network_id, row.contract_address), snippet)
    // Loose key for the refs that carry no contract address; first row wins,
    // which in practice is the only row that matched that (id, network).
    const loose = postKey(row.id, row.network_id, null)
    if (!snippets.has(loose)) snippets.set(loose, snippet)
  }

  return snippets
}

export async function GET(request) {
  try {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    // Retire rows that can never be emailed — unworthy action types and
    // recipients without a usable address alike — so they stop matching the
    // sweep. action_type is NOT NULL, so `NOT IN` here can never go three-valued
    // and strand a row as pending forever.
    const [skipped] = await pool.execute(
      `UPDATE notifications n
       LEFT JOIN users u ON u.wallet_address = n.recipient_wallet_address
       SET n.email_status = 'skipped'
       WHERE n.email_status = 'pending'
       AND (n.action_type NOT IN (${WORTHY_PLACEHOLDERS})
         OR u.wallet_address IS NULL OR u.email IS NULL OR u.email_verified_at IS NULL OR u.email_notifications = 0)`,
      [...EMAIL_WORTHY_TYPES],
    )

    const [rows] = await pool.execute(
      `SELECT n.id, n.recipient_wallet_address, n.actor_wallet_address, n.action_type, n.network_id, n.data,
       n.title, n.message, n.action_url, u.email,
       a.name AS actor_name, a.profileImage AS actor_profile_image
       FROM notifications n
       JOIN users u ON u.wallet_address = n.recipient_wallet_address
       LEFT JOIN users a ON a.wallet_address = n.actor_wallet_address
       WHERE n.email_status = 'pending'
       AND n.action_type IN (${WORTHY_PLACEHOLDERS})
       AND u.email IS NOT NULL AND u.email_verified_at IS NOT NULL AND u.email_notifications = 1
       ORDER BY n.recipient_wallet_address, n.created_at
       LIMIT ${MAX_ROWS}`,
      [...EMAIL_WORTHY_TYPES],
    )

    const byRecipient = new Map()
    for (const row of rows) {
      const list = byRecipient.get(row.recipient_wallet_address) || []
      list.push(row)
      byRecipient.set(row.recipient_wallet_address, list)
    }

    // Snippets are read once for the whole sweep, and only for the rows that
    // reach a listed line — the ones folded into "+N more" quote nothing.
    const recipients = Array.from(byRecipient.values()).slice(0, MAX_RECIPIENTS)
    const snippets = await fetchSnippets(recipients.flatMap((items) => items.slice(0, MAX_LISTED).map(snippetRef)))

    let sent = 0
    let failed = 0
    for (const items of recipients) {
      const listed = items.slice(0, MAX_LISTED).map((row) => {
        const ref = snippetRef(row)
        return {
          line: digestLine(row),
          snippet: ref ? snippets.get(postKey(ref.postId, ref.networkId, ref.contractAddress)) || null : null,
          action_url: row.action_url,
          avatar: resolveAvatarImageUrl(row.actor_profile_image, DIGEST_AVATAR_SIZE, DIGEST_AVATAR_OPTIONS),
        }
      })
      try {
        await sendNotificationDigest(items[0].email, listed, items.length - listed.length)
        await pool.execute(`UPDATE notifications SET email_status = 'sent' WHERE id IN (${items.map(() => '?').join(',')})`, [
          ...items.map((item) => item.id),
        ])
        sent += 1
      } catch (error) {
        // Left pending on purpose: transient SMTP failures retry next sweep
        console.error(`[NOTIFY_EMAIL_CRON] send failed for ${items[0].email}:`, error.message)
        failed += 1
      }
    }

    return NextResponse.json({ success: true, recipients: sent, failed, skipped: skipped.affectedRows, pendingRows: rows.length })
  } catch (error) {
    console.error('[NOTIFY_EMAIL_CRON_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Sweep failed' }, { status: 500 })
  }
}

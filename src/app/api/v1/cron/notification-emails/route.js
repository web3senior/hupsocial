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
 * Vercel cron GETs this path with `Authorization: Bearer ${CRON_SECRET}`
 * (vercel.json); locally the same curl works.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { sendNotificationDigest } from '@/lib/mailer'
import { resolveStorageImageUrl } from '@/lib/storageHelper'

// Serverless-budget caps: recipients per run, rows fetched per run, and lines
// actually listed in one digest (the rest is folded into "+N more").
const MAX_RECIPIENTS = 50
const MAX_ROWS = 500
const MAX_LISTED = 10

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

const shortWallet = (wallet) => `${wallet.slice(0, 6)}...${wallet.slice(-4)}`

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
      `SELECT n.id, n.recipient_wallet_address, n.actor_wallet_address, n.title, n.message, n.action_url, u.email,
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

    let sent = 0
    let failed = 0
    for (const [, items] of Array.from(byRecipient).slice(0, MAX_RECIPIENTS)) {
      const listed = items.slice(0, MAX_LISTED).map((row) => ({
        line: digestLine(row),
        action_url: row.action_url,
        avatar: resolveStorageImageUrl(row.actor_profile_image, { width: 64 }),
      }))
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

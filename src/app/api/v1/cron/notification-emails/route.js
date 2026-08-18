/**
 * @file app/api/v1/cron/notification-emails/route.js
 * @description Sweeps pending notifications into per-recipient digest emails.
 *
 * cidex (and the few in-app writers) insert notification rows with
 * email_status='pending' by column default; this sweeper is the only thing
 * that talks SMTP, keeping the "indexers index, the app delivers" split. Each
 * run sends AT MOST one email per recipient regardless of how many rows are
 * pending — a viral post becomes one digest, not a hundred messages. Rows for
 * recipients with no verified, enabled email are marked skipped so the pending
 * set never grows unbounded.
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

const shortWallet = (wallet) => `${wallet.slice(0, 6)}...${wallet.slice(-4)}`

/**
 * Builds the digest line for one notification row. cidex copy leads with a
 * short wallet label ("0x1234...abcd liked your post.") because that is all an
 * indexer knows; at send time the actor's current profile is one join away, so
 * the label is upgraded to their display name. Case-insensitive prefix match:
 * cidex shortens the checksummed event address while the column may store
 * lowercase.
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

    // Retire rows that can never be emailed, so they stop matching the sweep
    const [skipped] = await pool.execute(
      `UPDATE notifications n
       LEFT JOIN users u ON u.wallet_address = n.recipient_wallet_address
       SET n.email_status = 'skipped'
       WHERE n.email_status = 'pending'
       AND (u.wallet_address IS NULL OR u.email IS NULL OR u.email_verified_at IS NULL OR u.email_notifications = 0)`,
    )

    const [rows] = await pool.execute(
      `SELECT n.id, n.recipient_wallet_address, n.actor_wallet_address, n.title, n.message, n.action_url, u.email,
       a.name AS actor_name, a.profileImage AS actor_profile_image
       FROM notifications n
       JOIN users u ON u.wallet_address = n.recipient_wallet_address
       LEFT JOIN users a ON a.wallet_address = n.actor_wallet_address
       WHERE n.email_status = 'pending'
       AND u.email IS NOT NULL AND u.email_verified_at IS NOT NULL AND u.email_notifications = 1
       ORDER BY n.recipient_wallet_address, n.created_at
       LIMIT ${MAX_ROWS}`,
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

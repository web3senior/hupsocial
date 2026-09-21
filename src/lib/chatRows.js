/**
 * @file lib/chatRows.js
 * @description The one SELECT and the one shape for a chat line, shared by every route that
 * hands lines to the browser. A line carries its sender, an optional GIF beside its text, and
 * the line it replies to, joined in so the quote renders without a second trip.
 */

import { isEvmAddress, normalizeAddress } from '@/lib/address'

export const BODY_MAX_CHARS = 1000

const GIF_HOSTS = new Set([
  'media.giphy.com',
  'media0.giphy.com',
  'media1.giphy.com',
  'media2.giphy.com',
  'media3.giphy.com',
  'media4.giphy.com',
  'i.giphy.com',
])

export const isGifUrl = (value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && GIF_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

export const viewerAddress = (raw) => {
  const address = normalizeAddress(raw)
  return isEvmAddress(address) ? address : null
}

/** Live lines of a room, with their sender and the line they answer. Append conditions and ORDER BY. */
export const LIVE_LINES = `SELECT m.id, m.kind, m.body, m.gif_url, m.reply_to, m.created_at, m.edited_at,
                                  u.wallet AS sender, u.role AS sender_role,
                                  r.body AS reply_body, r.kind AS reply_kind, r.gif_url AS reply_gif, r.deleted_at AS reply_deleted,
                                  ru.wallet AS reply_sender
                             FROM chat_messages m
                             JOIN chat_users u ON u.id = m.sender_id
                        LEFT JOIN chat_messages r ON r.id = m.reply_to
                        LEFT JOIN chat_users ru ON ru.id = r.sender_id
                            WHERE m.room = ? AND m.deleted_at IS NULL`

/** @returns the browser shape of one line */
export const serializeLine = (row) => ({
  id: Number(row.id),
  sender: row.sender,
  senderRole: row.sender_role,
  kind: row.kind,
  body: row.body,
  gif: row.gif_url || null,
  createdAt: row.created_at,
  editedAt: row.edited_at,
  replyTo: row.reply_to
    ? {
        id: Number(row.reply_to),
        sender: row.reply_sender || null,
        body: row.reply_deleted ? '' : row.reply_body || '',
        gif: row.reply_deleted ? null : row.reply_gif || null,
        deleted: Boolean(row.reply_deleted) || !row.reply_sender,
      }
    : null,
})

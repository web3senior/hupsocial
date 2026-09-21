/**
 * @file lib/chatRows.js
 * @description The one SELECT and the one shape for a chat line, shared by every route that
 * hands lines to the browser. A line carries its sender, an optional GIF beside its text, and
 * the line it replies to, joined in so the quote renders without a second trip.
 */

import { isEvmAddress, normalizeAddress } from '@/lib/address'

export const BODY_MAX_CHARS = 1000

// The room keeps four weeks. Older lines are dropped for good, at most once an hour per server
// instance, from the write and poll paths, so no scheduler has to exist for it to happen.
export const RETENTION_DAYS = 28
const PRUNE_EVERY_MS = 60 * 60 * 1000
let lastPruneAt = 0

/** Drops lines past retention when an hour has gone by since the last look. Never throws. */
export const pruneOldLines = async (pool) => {
  const now = Date.now()
  if (now - lastPruneAt < PRUNE_EVERY_MS) return
  lastPruneAt = now
  try {
    await pool.execute('DELETE FROM chat_messages WHERE created_at < NOW(3) - INTERVAL ? DAY LIMIT 5000', [RETENTION_DAYS])
  } catch (error) {
    console.error('[CHAT_PRUNE_ERROR]:', error)
  }
}

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

// The reactions a line can take: a short fixed set, so a chip row never turns into a zoo
export const REACTIONS = ['👍', '❤️', '😂', '🔥', '😮', '😢', '🙏', '👀']

// How many of the people behind one chip travel with it, for the list shown on hover
const REACTORS_SHOWN = 8

/**
 * Adds `reactions` to each serialized line: one entry per emoji with its count, whether the
 * viewer is among them, and the first few wallets behind it. Two queries for the whole page:
 * the counts are grouped, and the names come capped, so a wildly reacted line stays cheap.
 * @param {import('mysql2/promise').Pool} pool
 * @param {object[]} lines serialized lines, mutated in place
 * @param {number|null} viewerId chat_users.id of the reader, when signed in
 */
export const attachReactions = async (pool, lines, viewerId = null) => {
  for (const line of lines) line.reactions = []
  const ids = lines.map((line) => line.id).filter((id) => Number.isInteger(id) && id > 0)
  if (!ids.length) return lines

  const [rows] = await pool.query(
    `SELECT message_id, emoji, COUNT(*) AS n, MAX(user_id = ?) AS mine
       FROM chat_reactions WHERE message_id IN (?) GROUP BY message_id, emoji`,
    [viewerId ?? 0, ids]
  )
  const byId = new Map(lines.map((line) => [line.id, line]))
  for (const row of rows) {
    const line = byId.get(Number(row.message_id))
    if (!line) continue
    line.reactions.push({ emoji: row.emoji, count: Number(row.n), mine: Boolean(Number(row.mine)), by: [] })
  }

  // Oldest first, so the list reads as the order people arrived; the cap is per page, and each
  // chip then keeps its own first few, so one busy line cannot crowd the others out
  const [people] = await pool.query(
    `SELECT r.message_id, r.emoji, u.wallet
       FROM chat_reactions r JOIN chat_users u ON u.id = r.user_id
      WHERE r.message_id IN (?) ORDER BY r.created_at ASC LIMIT ${ids.length * REACTORS_SHOWN * 4}`,
    [ids]
  )
  for (const row of people) {
    const reaction = byId.get(Number(row.message_id))?.reactions.find((entry) => entry.emoji === row.emoji)
    if (reaction && reaction.by.length < REACTORS_SHOWN) reaction.by.push(row.wallet)
  }

  // Chips in the order of the fixed set, so the same reactions read the same on every line
  for (const line of lines) line.reactions.sort((a, b) => REACTIONS.indexOf(a.emoji) - REACTIONS.indexOf(b.emoji))
  return lines
}

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

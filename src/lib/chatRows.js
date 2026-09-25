/**
 * @file lib/chatRows.js
 * @description The one SELECT and the one shape for a chat line, shared by every route that
 * hands lines to the browser. A line carries its sender, an optional GIF beside its text, and
 * the line it replies to, joined in so the quote renders without a second trip.
 */

import { isEvmAddress, normalizeAddress } from '@/lib/address'

export const BODY_MAX_CHARS = 1000

const ROOMS = new Set(['global'])

/** @returns {string|null} the room a request names, 'global' when it names none, null when unknown */
export const chatRoomFrom = (raw) => {
  const room = typeof raw === 'string' && raw ? raw : 'global'
  return ROOMS.has(room) ? room : null
}

// --- Read cursors: how far a wallet has read a room, kept here so every device agrees ---

/** @returns {Promise<number>} the newest line the wallet has read in the room, 0 before any. Never throws. */
export const loadReadCursor = async (pool, userId, room) => {
  try {
    const [[row]] = await pool.execute('SELECT last_read_id FROM chat_reads WHERE user_id = ? AND room = ? LIMIT 1', [userId, room])
    return Number(row?.last_read_id) || 0
  } catch (error) {
    console.error('[CHAT_READ_CURSOR_ERROR]:', error)
    return 0
  }
}

/**
 * Moves the wallet's cursor forward, never back and never past the room's newest line, so a
 * cursor left over from a rebuilt table cannot swallow every line that comes after it.
 * @returns {Promise<number>} where the cursor now sits
 */
export const advanceReadCursor = async (pool, userId, room, lineId) => {
  const [[latest]] = await pool.execute('SELECT MAX(id) AS id FROM chat_messages WHERE room = ? AND deleted_at IS NULL', [room])
  const target = Math.min(lineId, Number(latest?.id) || 0)
  if (target > 0) {
    await pool.execute(
      `INSERT INTO chat_reads (user_id, room, last_read_id) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE last_read_id = GREATEST(last_read_id, ?)`,
      [userId, room, target, target]
    )
  }
  return loadReadCursor(pool, userId, room)
}

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

// Who counts as around: a signed-in wallet with the room open. The open room polls every 4s and
// stamps at most every 15s, so this outlasts a missed poll; minimizing clears the stamp at once.
const PRESENCE_WINDOW_S = 45
const PRESENCE_SHOWN = 20
// One stamp per wallet per instance in this window: the open room would otherwise write every 4s
const PRESENCE_WRITE_EVERY_MS = 15 * 1000
const lastTouch = new Map()

/** Marks a wallet as around, at most once every few seconds, or takes it off. Never throws. */
export const touchPresence = async (pool, userId, on = true) => {
  if (!userId) return
  const now = Date.now()
  // Leaving always goes through; staying is throttled
  if (on) {
    if (now - (lastTouch.get(userId) ?? 0) < PRESENCE_WRITE_EVERY_MS) return
    lastTouch.set(userId, now)
  } else {
    lastTouch.delete(userId)
  }
  // The map would otherwise hold every wallet the instance has ever seen
  if (lastTouch.size > 500) for (const [id, at] of lastTouch) if (now - at > PRESENCE_WINDOW_S * 1000) lastTouch.delete(id)
  try {
    await pool.execute(`UPDATE chat_users SET last_seen_at = ${on ? 'NOW(3)' : 'NULL'} WHERE id = ?`, [userId])
  } catch (error) {
    console.error('[CHAT_PRESENCE_ERROR]:', error)
  }
}

/** @returns {Promise<{wallets: string[], count: number}>} who is around, most recent first */
export const fetchPresence = async (pool) => {
  try {
    const [rows] = await pool.execute(
      `SELECT wallet FROM chat_users WHERE last_seen_at > NOW(3) - INTERVAL ? SECOND
        ORDER BY last_seen_at DESC LIMIT ${PRESENCE_SHOWN}`,
      [PRESENCE_WINDOW_S]
    )
    const wallets = rows.map((row) => row.wallet)
    // Only a full page can be hiding more, so the usual quiet room costs one query
    if (wallets.length < PRESENCE_SHOWN) return { wallets, count: wallets.length }
    const [[total]] = await pool.execute('SELECT COUNT(*) AS n FROM chat_users WHERE last_seen_at > NOW(3) - INTERVAL ? SECOND', [
      PRESENCE_WINDOW_S,
    ])
    return { wallets, count: Number(total.n) }
  } catch (error) {
    console.error('[CHAT_PRESENCE_READ_ERROR]:', error)
    return { wallets: [], count: 0 }
  }
}

// How long a keystroke keeps someone on the "typing…" line. The room polls every 4s, so this is
// a little over two polls: long enough to survive a pause for thought, short enough to go quiet.
const TYPING_WINDOW_S = 7
const TYPING_SHOWN = 3
const TYPING_WRITE_EVERY_MS = 2500
const lastTyping = new Map()

/** Marks a wallet as writing, or clears it. Never throws. */
export const touchTyping = async (pool, userId, on) => {
  if (!userId) return
  const now = Date.now()
  // Stopping always goes through; starting is throttled, since a keystroke is not a write
  if (on) {
    if (now - (lastTyping.get(userId) ?? 0) < TYPING_WRITE_EVERY_MS) return
    lastTyping.set(userId, now)
  } else {
    lastTyping.delete(userId)
  }
  try {
    await pool.execute(`UPDATE chat_users SET typing_at = ${on ? 'NOW(3)' : 'NULL'} WHERE id = ?`, [userId])
  } catch (error) {
    console.error('[CHAT_TYPING_ERROR]:', error)
  }
}

/** @returns {Promise<string[]>} wallets writing right now, never the reader's own */
export const fetchTyping = async (pool, excludeId = null) => {
  try {
    const [rows] = await pool.execute(
      `SELECT wallet FROM chat_users WHERE typing_at > NOW(3) - INTERVAL ? SECOND AND id <> ?
        ORDER BY typing_at DESC LIMIT ${TYPING_SHOWN}`,
      [TYPING_WINDOW_S, excludeId ?? 0]
    )
    return rows.map((row) => row.wallet)
  } catch (error) {
    console.error('[CHAT_TYPING_READ_ERROR]:', error)
    return []
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
export const LIVE_LINES = `SELECT m.id, m.kind, m.body, m.gif_url, m.reply_to, m.views, m.created_at, m.edited_at,
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

// A reader is a wallet or the guest id lib/viewer.js keeps for readers without one
const GUEST_ID = /^guest_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const VIEWS_BATCH_MAX = 100
// How many of the newest lines carry fresh view counts on each live poll
const VIEWS_REFRESHED = 40

export const viewerKey = (raw) => {
  const address = viewerAddress(raw)
  if (address) return address
  return typeof raw === 'string' && GUEST_ID.test(raw) ? raw.toLowerCase() : null
}

/**
 * Counts a reader once on each live line they have seen, never on their own, and brings the
 * counters of the lines that gained a reader up to date.
 * @returns {Promise<number>} how many lines gained a reader
 */
export const recordViews = async (pool, ids, viewer) => {
  const unique = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0).slice(0, VIEWS_BATCH_MAX)
  if (!unique.length || !viewer) return 0
  const [result] = await pool.query(
    `INSERT IGNORE INTO chat_message_views (message_id, viewer)
     SELECT m.id, ? FROM chat_messages m JOIN chat_users u ON u.id = m.sender_id
      WHERE m.id IN (?) AND m.deleted_at IS NULL AND u.wallet <> ?`,
    [viewer, unique, viewer]
  )
  if (!result.affectedRows) return 0
  await pool.query(
    'UPDATE chat_messages m SET m.views = (SELECT COUNT(*) FROM chat_message_views v WHERE v.message_id = m.id) WHERE m.id IN (?)',
    [unique]
  )
  return result.affectedRows
}

/** @returns {Promise<Record<number, number>>} view counts of the newest live lines of a room */
export const fetchRecentViews = async (pool, room) => {
  const [rows] = await pool.execute(
    `SELECT id, views FROM chat_messages WHERE room = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ${VIEWS_REFRESHED}`,
    [room]
  )
  return Object.fromEntries(rows.map((row) => [Number(row.id), Number(row.views) || 0]))
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
  views: Number(row.views) || 0,
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

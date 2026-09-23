/**
 * @file app/api/v1/chat/room/route.js
 * @description The public chat room. GET pages the room for anyone, in either direction from a
 * cursor, and can instead count what is newer than a cursor; POST appends a message for a wallet
 * with a chat session that is not banned.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { isEvmAddress, normalizeAddress } from '@/lib/address'
import { chatActorFromRequest, isBanned } from '@/lib/chatSession'
import {
  BODY_MAX_CHARS,
  LIVE_LINES,
  attachReactions,
  fetchPresence,
  isGifUrl,
  pruneOldLines,
  serializeLine,
  touchPresence,
} from '@/lib/chatRows'

export const runtime = 'nodejs'

const PAGE_LIMIT = 40
const RATE_WINDOW_S = 60
const RATE_LIMIT = 20
const UNREAD_CAP = 99
const RECENT_FACES = 3
const ROOMS = new Set(['global'])

const serialize = serializeLine
const LIVE = LIVE_LINES

const roomFrom = (raw) => {
  const room = typeof raw === 'string' && raw ? raw : 'global'
  return ROOMS.has(room) ? room : null
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const room = roomFrom(searchParams.get('room'))
    if (!room) return NextResponse.json({ success: false, error: 'Unknown room' }, { status: 404 })

    const headers = { 'Cache-Control': 'no-store' }
    const countAfter = Number(searchParams.get('countAfter'))
    if (Number.isFinite(countAfter) && searchParams.has('countAfter')) {
      // The minimized poll is the one call that keeps coming while nobody writes
      await pruneOldLines(pool)
      // A minimized reader is still around; the token says so, the query param only claims it
      const actor = await chatActorFromRequest(pool, request).catch(() => null)
      if (actor) await touchPresence(pool, actor.id)
      const [[row]] = await pool.execute(
        `SELECT COUNT(*) AS n FROM (SELECT id FROM chat_messages WHERE room = ? AND deleted_at IS NULL AND id > ? LIMIT ${UNREAD_CAP + 1}) c`,
        [room, Math.max(0, countAfter)]
      )
      const [[latest]] = await pool.execute('SELECT MAX(id) AS id FROM chat_messages WHERE room = ? AND deleted_at IS NULL', [room])
      // The last few distinct voices, for the faces on the minimized pill
      const [recent] = await pool.execute(
        `SELECT u.wallet FROM chat_messages m JOIN chat_users u ON u.id = m.sender_id
          WHERE m.room = ? AND m.deleted_at IS NULL ORDER BY m.id DESC LIMIT 30`,
        [room]
      )
      const recentSenders = [...new Set(recent.map((r) => r.wallet))].slice(0, RECENT_FACES)

      // Unread lines that mention the viewer, by the mention link's address; the collation is
      // case-insensitive so the checksummed form in the body matches the lowercase wallet
      let mentions = 0
      let firstMentionId = 0
      const viewer = actor?.wallet ?? normalizeAddress(searchParams.get('viewer'))
      if (isEvmAddress(viewer)) {
        const [hits] = await pool.execute(
          `SELECT id FROM chat_messages WHERE room = ? AND deleted_at IS NULL AND id > ? AND body LIKE ? ORDER BY id ASC LIMIT ${UNREAD_CAP + 1}`,
          [room, Math.max(0, countAfter), `%](/${viewer})%`]
        )
        mentions = hits.length
        firstMentionId = Number(hits[0]?.id) || 0
      }

      return NextResponse.json(
        { success: true, count: Number(row.n), latestId: Number(latest.id) || 0, recentSenders, mentions, firstMentionId },
        { headers }
      )
    }

    const after = Number(searchParams.get('after')) || 0
    const before = Number(searchParams.get('before')) || 0
    const deletedSince = searchParams.get('deletedSince')

    let rows
    if (after > 0) {
      ;[rows] = await pool.execute(`${LIVE} AND m.id > ? ORDER BY m.id ASC LIMIT ${PAGE_LIMIT}`, [room, after])
    } else if (before > 0) {
      ;[rows] = await pool.execute(`${LIVE} AND m.id < ? ORDER BY m.id DESC LIMIT ${PAGE_LIMIT}`, [room, before])
      rows.reverse()
    } else {
      ;[rows] = await pool.execute(`${LIVE} ORDER BY m.id DESC LIMIT ${PAGE_LIMIT}`, [room])
      rows.reverse()
    }

    // Lines removed or rewritten since the client last asked, so open rooms follow along
    let removed = []
    let edited = []
    if (deletedSince) {
      const since = new Date(deletedSince)
      if (!Number.isNaN(since.getTime())) {
        const [gone] = await pool.execute('SELECT id FROM chat_messages WHERE room = ? AND deleted_at > ? LIMIT 200', [room, since])
        removed = gone.map((row) => Number(row.id))
        const [changed] = await pool.execute(`${LIVE} AND (m.edited_at > ? OR m.reacted_at > ?) ORDER BY m.id ASC LIMIT 200`, [
          room,
          since,
          since,
        ])
        edited = changed.map(serialize)
      }
    }

    // Reading is public, but a token on the request lets the chips say which reactions are the
    // reader's, and marks them as around
    const viewer = await chatActorFromRequest(pool, request).catch(() => null)
    if (viewer) await touchPresence(pool, viewer.id)
    const messages = await attachReactions(pool, rows.map(serialize), viewer?.id ?? null)
    await attachReactions(pool, edited, viewer?.id ?? null)
    const presence = await fetchPresence(pool)

    return NextResponse.json(
      {
        success: true,
        room,
        messages,
        hasMore: rows.length === PAGE_LIMIT,
        removed,
        edited,
        online: presence.wallets,
        onlineCount: presence.count,
        serverTime: new Date().toISOString(),
      },
      { headers }
    )
  } catch (error) {
    console.error('[CHAT_ROOM_GET_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to load the room' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const me = await chatActorFromRequest(pool, request)
    if (!me) return NextResponse.json({ success: false, error: 'Sign in to chat first' }, { status: 401 })
    if (isBanned(me)) {
      return NextResponse.json(
        { success: false, error: 'You are banned from chat', bannedUntil: me.banned_until, reason: me.ban_reason },
        { status: 403 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const room = roomFrom(body?.room)
    if (!room) return NextResponse.json({ success: false, error: 'Unknown room' }, { status: 404 })

    // A line is text, a GIF, or a GIF with a caption; a reply points at a live line of the room
    const text = typeof body?.body === 'string' ? body.body.trim() : ''
    const gif = typeof body?.gif === 'string' && body.gif ? body.gif.trim() : null
    const kind = gif ? 'gif' : 'text'
    if (!text && !gif) return NextResponse.json({ success: false, error: 'Write something first' }, { status: 400 })
    if (text.length > BODY_MAX_CHARS) {
      return NextResponse.json({ success: false, error: `Messages are capped at ${BODY_MAX_CHARS} characters` }, { status: 400 })
    }
    if (gif && (gif.length > 500 || !isGifUrl(gif))) {
      return NextResponse.json({ success: false, error: 'Only Giphy GIFs can be sent' }, { status: 400 })
    }
    let replyTo = null
    if (body?.replyTo != null) {
      const target = Number(body.replyTo)
      const [[quoted]] =
        Number.isInteger(target) && target > 0
          ? await pool.execute('SELECT id FROM chat_messages WHERE id = ? AND room = ? AND deleted_at IS NULL LIMIT 1', [target, room])
          : [[null]]
      if (!quoted) return NextResponse.json({ success: false, error: 'That message is gone' }, { status: 400 })
      replyTo = target
    }

    const [[recent]] = await pool.execute(
      'SELECT COUNT(*) AS n FROM chat_messages WHERE sender_id = ? AND created_at > NOW(3) - INTERVAL ? SECOND',
      [me.id, RATE_WINDOW_S]
    )
    if (Number(recent.n) >= RATE_LIMIT) {
      return NextResponse.json({ success: false, error: 'Slow down a little' }, { status: 429 })
    }

    const [result] = await pool.execute(
      'INSERT INTO chat_messages (room, sender_id, kind, body, gif_url, reply_to) VALUES (?, ?, ?, ?, ?, ?)',
      [room, me.id, kind, text, gif, replyTo]
    )
    const [[row]] = await pool.execute(`${LIVE} AND m.id = ?`, [room, result.insertId])
    await pruneOldLines(pool)
    const [message] = await attachReactions(pool, [serialize(row)], me.id)

    return NextResponse.json({ success: true, message }, { status: 201 })
  } catch (error) {
    console.error('[CHAT_ROOM_POST_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to send the message' }, { status: 500 })
  }
}

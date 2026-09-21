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

export const runtime = 'nodejs'

const PAGE_LIMIT = 40
const BODY_MAX_CHARS = 1000
const RATE_WINDOW_S = 60
const RATE_LIMIT = 20
const UNREAD_CAP = 99
const RECENT_FACES = 3
const ROOMS = new Set(['global'])
const GIF_HOSTS = new Set([
  'media.giphy.com',
  'media0.giphy.com',
  'media1.giphy.com',
  'media2.giphy.com',
  'media3.giphy.com',
  'media4.giphy.com',
  'i.giphy.com',
])

const serialize = (row) => ({
  id: Number(row.id),
  sender: row.sender,
  senderRole: row.sender_role,
  kind: row.kind,
  body: row.body,
  createdAt: row.created_at,
})

const roomFrom = (raw) => {
  const room = typeof raw === 'string' && raw ? raw : 'global'
  return ROOMS.has(room) ? room : null
}

const LIVE = `SELECT m.id, m.kind, m.body, m.created_at, u.wallet AS sender, u.role AS sender_role
                FROM chat_messages m JOIN chat_users u ON u.id = m.sender_id
               WHERE m.room = ? AND m.deleted_at IS NULL`

const isGifUrl = (value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && GIF_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const room = roomFrom(searchParams.get('room'))
    if (!room) return NextResponse.json({ success: false, error: 'Unknown room' }, { status: 404 })

    const headers = { 'Cache-Control': 'no-store' }
    const countAfter = Number(searchParams.get('countAfter'))
    if (Number.isFinite(countAfter) && searchParams.has('countAfter')) {
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
      const viewer = normalizeAddress(searchParams.get('viewer'))
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

    // Ids removed by a moderator since the client last asked, so open rooms drop them too
    let removed = []
    if (deletedSince) {
      const since = new Date(deletedSince)
      if (!Number.isNaN(since.getTime())) {
        const [gone] = await pool.execute('SELECT id FROM chat_messages WHERE room = ? AND deleted_at > ? LIMIT 200', [room, since])
        removed = gone.map((row) => Number(row.id))
      }
    }

    return NextResponse.json(
      {
        success: true,
        room,
        messages: rows.map(serialize),
        hasMore: rows.length === PAGE_LIMIT,
        removed,
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

    const kind = body?.kind === 'gif' ? 'gif' : 'text'
    const text = typeof body?.body === 'string' ? body.body.trim() : ''
    if (!text) return NextResponse.json({ success: false, error: 'Write something first' }, { status: 400 })
    if (text.length > BODY_MAX_CHARS) {
      return NextResponse.json({ success: false, error: `Messages are capped at ${BODY_MAX_CHARS} characters` }, { status: 400 })
    }
    if (kind === 'gif' && !isGifUrl(text)) {
      return NextResponse.json({ success: false, error: 'Only Giphy GIFs can be sent' }, { status: 400 })
    }

    const [[recent]] = await pool.execute(
      'SELECT COUNT(*) AS n FROM chat_messages WHERE sender_id = ? AND created_at > NOW(3) - INTERVAL ? SECOND',
      [me.id, RATE_WINDOW_S]
    )
    if (Number(recent.n) >= RATE_LIMIT) {
      return NextResponse.json({ success: false, error: 'Slow down a little' }, { status: 429 })
    }

    const [result] = await pool.execute('INSERT INTO chat_messages (room, sender_id, kind, body) VALUES (?, ?, ?, ?)', [
      room,
      me.id,
      kind,
      text,
    ])
    const [[row]] = await pool.execute(`${LIVE} AND m.id = ?`, [room, result.insertId])

    return NextResponse.json({ success: true, message: serialize(row) }, { status: 201 })
  } catch (error) {
    console.error('[CHAT_ROOM_POST_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to send the message' }, { status: 500 })
  }
}

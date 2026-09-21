/**
 * @file app/api/v1/chat/message/route.js
 * @description A wallet's own line in the public room: PATCH rewrites a text line, DELETE takes
 * it back. Both need the chat session and only ever touch the caller's own lines; a moderator
 * removing somebody else's goes through chat/moderation.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { chatActorFromRequest, isBanned } from '@/lib/chatSession'

export const runtime = 'nodejs'

const BODY_MAX_CHARS = 1000
// How long a line stays editable
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000

const serialize = (row) => ({
  id: Number(row.id),
  sender: row.sender,
  senderRole: row.sender_role,
  kind: row.kind,
  body: row.body,
  createdAt: row.created_at,
  editedAt: row.edited_at,
})

const ownLine = async (me, rawId) => {
  const id = Number(rawId)
  if (!Number.isInteger(id) || id <= 0) return { error: 'A message id is required', status: 400 }
  const [[row]] = await pool.execute(
    `SELECT m.id, m.sender_id, m.kind, m.created_at, m.deleted_at FROM chat_messages m WHERE m.id = ? LIMIT 1`,
    [id]
  )
  if (!row || row.deleted_at) return { error: 'No such message', status: 404 }
  if (Number(row.sender_id) !== Number(me.id)) return { error: 'You can only change your own messages', status: 403 }
  return { row }
}

export async function PATCH(request) {
  try {
    const me = await chatActorFromRequest(pool, request)
    if (!me) return NextResponse.json({ success: false, error: 'Sign in to chat first' }, { status: 401 })
    if (isBanned(me)) return NextResponse.json({ success: false, error: 'You are banned from chat' }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const found = await ownLine(me, body?.messageId)
    if (found.error) return NextResponse.json({ success: false, error: found.error }, { status: found.status })
    if (found.row.kind !== 'text') return NextResponse.json({ success: false, error: 'Only text can be edited' }, { status: 400 })
    if (Date.now() - new Date(found.row.created_at).getTime() > EDIT_WINDOW_MS) {
      return NextResponse.json({ success: false, error: 'This message is too old to edit' }, { status: 400 })
    }

    const text = typeof body?.body === 'string' ? body.body.trim() : ''
    if (!text) return NextResponse.json({ success: false, error: 'Write something first' }, { status: 400 })
    if (text.length > BODY_MAX_CHARS) {
      return NextResponse.json({ success: false, error: `Messages are capped at ${BODY_MAX_CHARS} characters` }, { status: 400 })
    }

    await pool.execute('UPDATE chat_messages SET body = ?, edited_at = NOW(3) WHERE id = ?', [text, found.row.id])
    const [[row]] = await pool.execute(
      `SELECT m.id, m.kind, m.body, m.created_at, m.edited_at, u.wallet AS sender, u.role AS sender_role
         FROM chat_messages m JOIN chat_users u ON u.id = m.sender_id WHERE m.id = ?`,
      [found.row.id]
    )
    return NextResponse.json({ success: true, message: serialize(row) })
  } catch (error) {
    console.error('[CHAT_MESSAGE_PATCH_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to edit the message' }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const me = await chatActorFromRequest(pool, request)
    if (!me) return NextResponse.json({ success: false, error: 'Sign in to chat first' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const found = await ownLine(me, body?.messageId)
    if (found.error) return NextResponse.json({ success: false, error: found.error }, { status: found.status })

    await pool.execute('UPDATE chat_messages SET deleted_at = NOW(3), deleted_by = ? WHERE id = ? AND deleted_at IS NULL', [
      me.id,
      found.row.id,
    ])
    return NextResponse.json({ success: true, messageId: found.row.id })
  } catch (error) {
    console.error('[CHAT_MESSAGE_DELETE_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to delete the message' }, { status: 500 })
  }
}

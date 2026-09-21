/**
 * @file app/api/v1/chat/reaction/route.js
 * @description Toggles one emoji of the fixed set on a line for the signed-in wallet, and stamps
 * the line so open rooms refresh it on their next poll. Returns the line's reactions as the
 * caller now sees them.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { chatActorFromRequest, isBanned } from '@/lib/chatSession'
import { REACTIONS, attachReactions } from '@/lib/chatRows'

export const runtime = 'nodejs'

export async function POST(request) {
  try {
    const me = await chatActorFromRequest(pool, request)
    if (!me) return NextResponse.json({ success: false, error: 'Sign in to chat first' }, { status: 401 })
    if (isBanned(me)) return NextResponse.json({ success: false, error: 'You are banned from chat' }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const id = Number(body?.messageId)
    const emoji = typeof body?.emoji === 'string' ? body.emoji : ''
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ success: false, error: 'A message id is required' }, { status: 400 })
    if (!REACTIONS.includes(emoji)) return NextResponse.json({ success: false, error: 'Not one of the reactions' }, { status: 400 })

    const [[line]] = await pool.execute('SELECT id FROM chat_messages WHERE id = ? AND deleted_at IS NULL LIMIT 1', [id])
    if (!line) return NextResponse.json({ success: false, error: 'No such message' }, { status: 404 })

    const [removed] = await pool.execute('DELETE FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', [
      id,
      me.id,
      emoji,
    ])
    const reacted = removed.affectedRows === 0
    if (reacted) {
      await pool.execute('INSERT IGNORE INTO chat_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)', [id, me.id, emoji])
    }
    await pool.execute('UPDATE chat_messages SET reacted_at = NOW(3) WHERE id = ?', [id])

    const [withReactions] = await attachReactions(pool, [{ id }], me.id)
    return NextResponse.json({ success: true, messageId: id, emoji, reacted, reactions: withReactions.reactions })
  } catch (error) {
    console.error('[CHAT_REACTION_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to react' }, { status: 500 })
  }
}

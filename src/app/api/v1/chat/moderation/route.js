/**
 * @file app/api/v1/chat/moderation/route.js
 * @description Moderator actions on the public room. A moderator (or the admin) removes a
 * message or bans a wallet for a number of days; only the admin grants and revokes the
 * moderator role. Moderators cannot act on the admin or on each other.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { isEvmAddress, normalizeAddress } from '@/lib/address'
import { canModerate, chatActorFromRequest, ensureChatUser, isChatAdmin } from '@/lib/chatSession'

export const runtime = 'nodejs'

const BAN_DAYS = new Set([1, 3, 7, 30])
const REASON_MAX = 200

const forbidden = (error = 'Moderators only') => NextResponse.json({ success: false, error }, { status: 403 })

export async function POST(request) {
  try {
    const me = await chatActorFromRequest(pool, request)
    if (!me) return NextResponse.json({ success: false, error: 'Sign in to chat first' }, { status: 401 })
    if (!canModerate(me)) return forbidden()

    const body = await request.json().catch(() => ({}))
    const action = body?.action

    if (action === 'delete') {
      const id = Number(body?.messageId)
      if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ success: false, error: 'A message id is required' }, { status: 400 })

      const [[target]] = await pool.execute(
        'SELECT m.id, u.wallet, u.role FROM chat_messages m JOIN chat_users u ON u.id = m.sender_id WHERE m.id = ? LIMIT 1',
        [id],
      )
      if (!target) return NextResponse.json({ success: false, error: 'No such message' }, { status: 404 })
      if (!isChatAdmin(me.wallet) && (isChatAdmin(target.wallet) || target.role === 'moderator')) {
        return forbidden('Only the admin can remove a moderator’s message')
      }

      await pool.execute('UPDATE chat_messages SET deleted_at = NOW(3), deleted_by = ? WHERE id = ? AND deleted_at IS NULL', [me.id, id])
      return NextResponse.json({ success: true, messageId: id })
    }

    const wallet = normalizeAddress(body?.wallet)
    if (!isEvmAddress(wallet)) return NextResponse.json({ success: false, error: 'A wallet address is required' }, { status: 400 })
    if (wallet === me.wallet) return forbidden('You cannot moderate yourself')
    if (isChatAdmin(wallet)) return forbidden('The admin cannot be moderated')

    const target = await ensureChatUser(pool, wallet)

    if (action === 'ban') {
      if (!isChatAdmin(me.wallet) && target.role === 'moderator') return forbidden('Only the admin can ban a moderator')
      const days = Number(body?.days)
      if (!BAN_DAYS.has(days)) return NextResponse.json({ success: false, error: 'Ban length must be 1, 3, 7 or 30 days' }, { status: 400 })
      const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, REASON_MAX) : null

      await pool.execute(
        'UPDATE chat_users SET banned_until = NOW() + INTERVAL ? DAY, banned_by = ?, ban_reason = ? WHERE id = ?',
        [days, me.id, reason || null, target.id],
      )
      const [[row]] = await pool.execute('SELECT banned_until FROM chat_users WHERE id = ?', [target.id])
      return NextResponse.json({ success: true, wallet, bannedUntil: row.banned_until })
    }

    if (action === 'unban') {
      await pool.execute('UPDATE chat_users SET banned_until = NULL, banned_by = NULL, ban_reason = NULL WHERE id = ?', [target.id])
      return NextResponse.json({ success: true, wallet, bannedUntil: null })
    }

    if (action === 'promote' || action === 'demote') {
      if (!isChatAdmin(me.wallet)) return forbidden('Only the admin can change roles')
      const role = action === 'promote' ? 'moderator' : 'member'
      await pool.execute('UPDATE chat_users SET role = ? WHERE id = ?', [role, target.id])
      return NextResponse.json({ success: true, wallet, role })
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('[CHAT_MODERATION_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Moderation action failed' }, { status: 500 })
  }
}

/** Public: who moderates the room, so the list can be shown without a token. */
export async function GET() {
  try {
    const [rows] = await pool.execute("SELECT wallet FROM chat_users WHERE role = 'moderator' ORDER BY id ASC LIMIT 100")
    return NextResponse.json({ success: true, moderators: rows.map((row) => row.wallet) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[CHAT_MODERATORS_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to list moderators' }, { status: 500 })
  }
}

/**
 * @file app/api/v1/chat/me/route.js
 * @description What the signed-in wallet is allowed to do in chat: its role, whether it is the
 * admin, and any ban in force.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { canModerate, chatActorFromRequest, isBanned, isChatAdmin } from '@/lib/chatSession'

export const runtime = 'nodejs'

export async function GET(request) {
  try {
    const me = await chatActorFromRequest(pool, request)
    if (!me) return NextResponse.json({ success: false, error: 'Sign in to chat first' }, { status: 401 })

    return NextResponse.json(
      {
        success: true,
        address: me.wallet,
        role: me.role,
        isAdmin: isChatAdmin(me.wallet),
        canModerate: canModerate(me),
        bannedUntil: isBanned(me) ? me.banned_until : null,
        banReason: isBanned(me) ? me.ban_reason : null,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[CHAT_ME_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to load chat status' }, { status: 500 })
  }
}

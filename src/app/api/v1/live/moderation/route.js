/**
 * @file app/api/v1/live/moderation/route.js
 * @description The cut-off. The admin or a chat moderator ends someone's stream; the row is
 * marked killed and the worker drops the video on its next sweep. Only the admin can cut off a
 * moderator's stream.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { canModerate, chatActorFromRequest, ensureChatUser, isChatAdmin } from '@/lib/chatSession'
import { killStream, liveTableExists } from '@/lib/liveServer'

export const runtime = 'nodejs'

export async function POST(request) {
  try {
    const me = await chatActorFromRequest(pool, request)
    if (!me) return NextResponse.json({ success: false, error: 'Sign in first' }, { status: 401 })
    if (!canModerate(me)) return NextResponse.json({ success: false, error: 'Moderators only' }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const id = Number(body?.id)
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ success: false, error: 'A stream id is required' }, { status: 400 })
    if (!(await liveTableExists())) return NextResponse.json({ success: false, error: 'No such stream' }, { status: 404 })

    const [[target]] = await pool.execute('SELECT wallet FROM live_streams WHERE id = ? LIMIT 1', [id])
    if (!target) return NextResponse.json({ success: false, error: 'No such stream' }, { status: 404 })

    if (!isChatAdmin(me.wallet)) {
      const streamer = await ensureChatUser(pool, target.wallet)
      if (canModerate(streamer)) {
        return NextResponse.json({ success: false, error: 'Only the admin can end a moderator’s stream' }, { status: 403 })
      }
    }

    const killed = await killStream(id, me.wallet)
    if (!killed) return NextResponse.json({ success: false, error: 'That stream has already ended' }, { status: 409 })

    return NextResponse.json({ success: true, id })
  } catch (error) {
    console.error('[LIVE_MODERATION_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Could not end the stream' }, { status: 500 })
  }
}

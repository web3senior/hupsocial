/**
 * @file app/api/v1/chat/read/route.js
 * @description How far the signed-in wallet has read a room. The cursor lives here rather than
 * in one browser, so every device the wallet chats from shows the same unread state. GET reads
 * it; POST moves it forward and never back.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { chatActorFromRequest } from '@/lib/chatSession'
import { advanceReadCursor, chatRoomFrom, loadReadCursor } from '@/lib/chatRows'

export const runtime = 'nodejs'

const headers = { 'Cache-Control': 'no-store' }

export async function GET(request) {
  try {
    const me = await chatActorFromRequest(pool, request)
    if (!me) return NextResponse.json({ success: false, error: 'Sign in to chat first' }, { status: 401 })

    const room = chatRoomFrom(new URL(request.url).searchParams.get('room'))
    if (!room) return NextResponse.json({ success: false, error: 'Unknown room' }, { status: 404 })

    const lastReadId = await loadReadCursor(pool, me.id, room)
    return NextResponse.json({ success: true, lastReadId }, { headers })
  } catch (error) {
    console.error('[CHAT_READ_GET_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to load the read position' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const me = await chatActorFromRequest(pool, request)
    if (!me) return NextResponse.json({ success: false, error: 'Sign in to chat first' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const room = chatRoomFrom(body?.room)
    if (!room) return NextResponse.json({ success: false, error: 'Unknown room' }, { status: 404 })

    const lineId = Number(body?.lastReadId)
    if (!Number.isSafeInteger(lineId) || lineId <= 0) {
      return NextResponse.json({ success: false, error: 'A message id is required' }, { status: 400 })
    }

    const lastReadId = await advanceReadCursor(pool, me.id, room, lineId)
    return NextResponse.json({ success: true, lastReadId }, { headers })
  } catch (error) {
    console.error('[CHAT_READ_POST_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to save the read position' }, { status: 500 })
  }
}

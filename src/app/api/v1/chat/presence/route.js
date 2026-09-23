/**
 * @file app/api/v1/chat/presence/route.js
 * @description Takes the signed-in wallet off the room's online list when it minimizes the chat
 * or closes the tab. Being around is stamped by the open room's own poll.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { chatActorFromRequest } from '@/lib/chatSession'
import { touchPresence } from '@/lib/chatRows'

export const runtime = 'nodejs'

export async function DELETE(request) {
  try {
    const me = await chatActorFromRequest(pool, request)
    if (!me) return NextResponse.json({ success: false, error: 'Sign in to chat first' }, { status: 401 })

    await touchPresence(pool, me.id, false)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[CHAT_PRESENCE_DELETE_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to leave the room' }, { status: 500 })
  }
}

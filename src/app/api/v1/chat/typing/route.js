/**
 * @file app/api/v1/chat/typing/route.js
 * @description Says the signed-in wallet is writing, or has stopped. The stamp expires on its
 * own, so a browser that closes mid-sentence goes quiet without telling anyone.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { chatActorFromRequest, isBanned } from '@/lib/chatSession'
import { touchTyping } from '@/lib/chatRows'

export const runtime = 'nodejs'

export async function POST(request) {
  try {
    const me = await chatActorFromRequest(pool, request)
    if (!me) return NextResponse.json({ success: false, error: 'Sign in to chat first' }, { status: 401 })
    if (isBanned(me)) return NextResponse.json({ success: false, error: 'You are banned from chat' }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    await touchTyping(pool, me.id, body?.typing !== false)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[CHAT_TYPING_POST_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to report typing' }, { status: 500 })
  }
}

/**
 * @file app/api/v1/chat/view/route.js
 * @description Records the lines a reader has had on screen. Reading is public, so a guest id
 * counts as well as a wallet; a chat token, when sent, stands in for whatever the body claims.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { chatActorFromRequest } from '@/lib/chatSession'
import { VIEWS_BATCH_MAX, recordViews, viewerKey } from '@/lib/chatRows'

export const runtime = 'nodejs'

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))
    const actor = await chatActorFromRequest(pool, request).catch(() => null)
    const viewer = viewerKey(actor?.wallet ?? body?.viewer)
    if (!viewer) return NextResponse.json({ success: false, error: 'A viewer is required' }, { status: 400 })

    const ids = Array.isArray(body?.ids) ? body.ids.map(Number) : []
    if (!ids.length || ids.length > VIEWS_BATCH_MAX) {
      return NextResponse.json({ success: false, error: `Send 1 to ${VIEWS_BATCH_MAX} message ids` }, { status: 400 })
    }

    const counted = await recordViews(pool, ids, viewer)
    return NextResponse.json({ success: true, counted })
  } catch (error) {
    console.error('[CHAT_VIEW_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to record views' }, { status: 500 })
  }
}

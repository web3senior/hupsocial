/**
 * @file app/api/v1/live/session/route.js
 * @description The streamer's side of a live stream. GET says whether the signed-in wallet may
 * go live and what it has open; POST opens a stream and hands back its one-time publish key;
 * DELETE ends it. Identity is the chat bearer token, so going live needs no second signature.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { appChains } from '@/config/contracts'
import { chatActorFromRequest, isBanned } from '@/lib/chatSession'
import { LIVE_STARTS_PER_HOUR, cleanLiveTitle } from '@/lib/live'
import { canGoLive, countRecentStarts, endOpenStreams, liveTableExists, openStream, readOpenStream } from '@/lib/liveServer'

export const runtime = 'nodejs'

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } }

const unauthorized = () => NextResponse.json({ success: false, error: 'Sign in first' }, { status: 401 })

const standing = async (me) => {
  if (isBanned(me)) return { allowed: false, reason: 'This wallet is banned until the ban runs out' }
  return canGoLive(me.wallet)
}

export async function GET(request) {
  try {
    const me = await chatActorFromRequest(pool, request)
    if (!me) return unauthorized()

    const [{ allowed, reason }, stream] = await Promise.all([standing(me), readOpenStream(me.wallet)])
    return NextResponse.json({ success: true, allowed, reason, stream }, NO_STORE)
  } catch (error) {
    console.error('[LIVE_SESSION_READ_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to load the studio' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const me = await chatActorFromRequest(pool, request)
    if (!me) return unauthorized()

    if (!(await liveTableExists())) {
      return NextResponse.json({ success: false, error: 'Live streaming is not set up yet' }, { status: 503 })
    }

    const { allowed, reason } = await standing(me)
    if (!allowed) return NextResponse.json({ success: false, error: reason }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const title = cleanLiveTitle(body?.title)
    const networkId = Number(body?.networkId)

    if (!title) return NextResponse.json({ success: false, error: 'Give the stream a title' }, { status: 400 })
    if (!appChains.some((chain) => chain.id === networkId)) {
      return NextResponse.json({ success: false, error: 'Connect to a network Hup supports' }, { status: 400 })
    }
    if ((await countRecentStarts(me.wallet)) >= LIVE_STARTS_PER_HOUR) {
      return NextResponse.json({ success: false, error: 'Too many streams started, try again later' }, { status: 429 })
    }

    const { id, key } = await openStream({ wallet: me.wallet, networkId, title })
    return NextResponse.json({ success: true, id, key, title, networkId }, NO_STORE)
  } catch (error) {
    console.error('[LIVE_SESSION_OPEN_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Could not start the stream' }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const me = await chatActorFromRequest(pool, request)
    if (!me) return unauthorized()

    const ended = (await liveTableExists()) ? await endOpenStreams(me.wallet) : 0
    return NextResponse.json({ success: true, ended }, NO_STORE)
  } catch (error) {
    console.error('[LIVE_SESSION_END_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Could not end the stream' }, { status: 500 })
  }
}

/**
 * @file api/v1/follows/route.js
 * @description Offchain following (config/socialGraph.js).
 *   GET ?viewer=0x…&targets=0x…,0x… — which of the targets the viewer follows, and which of those
 *     are LUKSO LSP26 follows an unfollow must also undo onchain.
 *   PUT { targets: [...], following: boolean } — follow or unfollow as the signed-in wallet
 *     (Bearer chat session token, the same session chat and the launchpad use).
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { isEvmAddress, normalizeAddress } from '@/lib/address'
import { chatActorFromRequest, isBanned } from '@/lib/chatSession'
import { FollowError, parseFollowTargets, readFollowRelations, setFollows } from '@/lib/socialFollows'

export const runtime = 'nodejs'

const privateResponse = { headers: { 'Cache-Control': 'private, no-store' } }

/* In-memory and per instance, like the relay's throttle: a brake on scripted follow churn, not a
   security boundary. Counts accounts changed, so one full batch follow fits comfortably. */
const WINDOW_MS = 60 * 60_000
const MAX_CHANGES_PER_WINDOW = 300
const changeLog = new Map()

const recentChanges = (wallet) => {
  const now = Date.now()
  const stamps = (changeLog.get(wallet) ?? []).filter((stamp) => now - stamp < WINDOW_MS)
  changeLog.set(wallet, stamps)
  if (changeLog.size > 5000) {
    for (const [key, list] of changeLog) if (list.every((stamp) => now - stamp >= WINDOW_MS)) changeLog.delete(key)
  }
  return stamps
}

const failure = (error, label) => {
  if (error instanceof FollowError) return NextResponse.json({ success: false, error: error.message }, { status: error.status })
  console.error(`[${label}]:`, error.message)
  return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const viewer = normalizeAddress(searchParams.get('viewer'))
    if (!isEvmAddress(viewer)) throw new FollowError('A viewer wallet is required')

    const targets = parseFollowTargets(searchParams.get('targets'), viewer)
    return NextResponse.json({ success: true, data: await readFollowRelations(pool, viewer, targets) }, privateResponse)
  } catch (error) {
    return failure(error, 'FOLLOWS_READ_ERROR')
  }
}

export async function PUT(request) {
  try {
    const actor = await chatActorFromRequest(pool, request)
    if (!actor) throw new FollowError('Sign in to follow', 401)
    if (isBanned(actor)) throw new FollowError('This account is currently restricted', 403)

    const follower = normalizeAddress(actor.wallet)
    if (!isEvmAddress(follower)) throw new FollowError('Following needs an EVM wallet', 403)

    const body = await request.json().catch(() => null)
    if (typeof body?.following !== 'boolean') throw new FollowError('following must be true or false')
    const targets = parseFollowTargets(body.targets, follower)

    const stamps = recentChanges(follower)
    if (stamps.length + targets.length > MAX_CHANGES_PER_WINDOW) throw new FollowError('Slow down — try again in a little while', 429)

    const changed = await setFollows(pool, follower, targets, body.following)
    stamps.push(...changed.map(() => Date.now()))

    return NextResponse.json({ success: true, data: { changed } }, privateResponse)
  } catch (error) {
    return failure(error, 'FOLLOWS_WRITE_ERROR')
  }
}

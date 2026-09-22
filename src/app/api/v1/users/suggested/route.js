/**
 * @file api/v1/users/suggested/route.js
 * @description A random handful of current Premium subscribers for the home rail's
 * "Who to follow" card. Premium is the whole selection rule: paying for Hup is the one signal
 * that every suggested account is a real, invested one. The viewer and anyone they already
 * follow are left out server-side so every row is actionable.
 */
import { NextResponse } from 'next/server'
import { premiumIsLive, readPremiumSuggestions } from '@/lib/premiumServer'

export const runtime = 'nodejs'

export async function GET(request) {
  try {
    const viewer = request.nextUrl.searchParams.get('viewer')
    const limit = Number(request.nextUrl.searchParams.get('limit')) || 3

    if (!premiumIsLive()) {
      return NextResponse.json({ success: true, data: { live: false, users: [] } })
    }

    const users = await readPremiumSuggestions({ exclude: viewer, limit })

    // Every call is a fresh shuffle; a cached copy would pin the same three faces to the rail.
    return NextResponse.json({ success: true, data: { live: true, users } }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[GET_SUGGESTED_USERS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

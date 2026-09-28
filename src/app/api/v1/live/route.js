/**
 * @file app/api/v1/live/route.js
 * @description Public list of the streams that are live right now, for the /live directory.
 * Cached at the edge for a few seconds so a busy directory costs one read, not one per visitor.
 */

import { NextResponse } from 'next/server'
import { readLiveStreams } from '@/lib/liveServer'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const streams = await readLiveStreams()
    return NextResponse.json(
      { success: true, data: streams },
      { headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' } },
    )
  } catch (error) {
    console.error('[LIVE_LIST_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to list live streams' }, { status: 500 })
  }
}

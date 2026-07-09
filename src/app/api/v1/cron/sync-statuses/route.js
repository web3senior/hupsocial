/**
 * @file api/v1/cron/sync-statuses/route.js
 * @description Syncs on-chain Status events into the `statuses` table across every
 * configured chain. Not wired to any scheduler in this repo — trigger it periodically
 * via an external cron (e.g. Windows Task Scheduler + curl) with the CRON_SECRET.
 */

import { NextResponse } from 'next/server'
import { syncAllStatuses } from '@/lib/statusChain'

export const runtime = 'nodejs'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const secret = request.headers.get('x-cron-secret') || searchParams.get('secret')

  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const results = await syncAllStatuses()
    return NextResponse.json({ success: true, results })
  } catch (error) {
    console.error('[SYNC_STATUSES_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to sync statuses' }, { status: 500 })
  }
}

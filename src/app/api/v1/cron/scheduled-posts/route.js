/**
 * @file app/api/v1/cron/scheduled-posts/route.js
 * @description Publishes every due scheduled post through the relayer, whether or not its author
 * is online.
 *
 * Vercel cron GETs this path every minute with `Authorization: Bearer ${CRON_SECRET}`
 * (vercel.json); locally the same curl works.
 */

import { NextResponse } from 'next/server'
import { hasTable } from '@/lib/schema'
import { deliverDueScheduledPosts } from '@/lib/scheduledDelivery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    if (!(await hasTable('scheduled_posts'))) return NextResponse.json({ success: true, skipped: 'not migrated' })

    const result = await deliverDueScheduledPosts({ limit: 50 })
    const counts = Object.fromEntries(Object.entries(result).map(([key, list]) => [key, list.length]))
    if (counts.sent || counts.failed || counts.retry) console.log('SCHEDULED_POSTS_SWEEP:', counts)

    return NextResponse.json({ success: true, ...counts })
  } catch (error) {
    console.error('[SCHEDULED_CRON_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Sweep failed' }, { status: 500 })
  }
}

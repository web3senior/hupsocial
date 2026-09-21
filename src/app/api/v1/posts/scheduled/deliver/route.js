/**
 * @file app/api/v1/posts/scheduled/deliver/route.js
 * @description The author's own trigger for the relayer sweep: publishes whichever of their
 * pre-signed posts are due right now. The shell runner calls it the minute a post comes due while
 * the author has Hup open, so a live author never waits on the cron, and a dev box without any
 * cron still delivers.
 */

import { NextResponse } from 'next/server'
import { hasTable } from '@/lib/schema'
import { scheduleAddressFromRequest } from '@/lib/scheduleSession'
import { deliverDueScheduledPosts } from '@/lib/scheduledDelivery'

export const runtime = 'nodejs'

export async function POST(request) {
  try {
    const address = scheduleAddressFromRequest(request)
    if (!address) return NextResponse.json({ success: false, error: 'Sign in to publish your scheduled posts' }, { status: 401 })
    if (!(await hasTable('scheduled_posts'))) {
      return NextResponse.json({ success: false, error: 'Scheduling is not available yet' }, { status: 503 })
    }

    const result = await deliverDueScheduledPosts({ walletAddress: address, limit: 10 })
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    console.error('[SCHEDULED_DELIVER_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Could not publish scheduled posts' }, { status: 500 })
  }
}

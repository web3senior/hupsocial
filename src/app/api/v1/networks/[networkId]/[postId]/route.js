/**
 * @file api/v1/networks/[networkId]/[postId]/route.js
 * @description Fetches a single post by its unique database ID and network context directly from the route layout parameters.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { readPostRow, shapePostRow } from '@/lib/postRows'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'
import { attachTipUsdTotals } from '@/lib/tipTotals'
import { attachSalesUsdTotals } from '@/lib/salesTotals'

export const runtime = 'nodejs'

export async function GET(request, { params }) {
  try {
    // Extract both dynamic route tokens directly from the incoming parameters object
    const { networkId, postId } = await params
    const { searchParams } = new URL(request.url)
    const viewerAddress = searchParams.get('viewer_address')

    const post = await readPostRow(networkId, postId, viewerAddress)

    if (!post) {
      return NextResponse.json({ success: false, error: 'Post not found' }, { status: 404 })
    }

    // The Universal Profile fill (a chain read for an author the users table has not seen) runs
    // beside the dollar totals rather than ahead of them; the two write different fields. The
    // totals stay in turn so they share one warm price cache. The tip badge and the post-tip
    // revalidation read this row.
    await Promise.all([
      fulfillUniversalProfiles([post], pool),
      (async () => {
        await attachTipUsdTotals([post])
        await attachSalesUsdTotals([post])
      })(),
    ])

    return NextResponse.json({ success: true, data: shapePostRow(post) })
  } catch (error) {
    console.error('[GET_POST_BY_ID_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

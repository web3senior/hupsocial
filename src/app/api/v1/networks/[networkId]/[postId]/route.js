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

/* A read with no viewer is the same for everyone, and feeds and the activity stream ask for the
   same few posts many times a second: the CDN answers them for half a minute and the browser for
   a few seconds, so a function runs once per post per half minute instead of once per card.
   A read for a viewer carries that viewer's likes and unlocked content, and is never shared. */
const PUBLIC_CACHE_CONTROL = 'public, max-age=15, s-maxage=30, stale-while-revalidate=300'

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

    return NextResponse.json(
      { success: true, data: shapePostRow(post) },
      viewerAddress ? undefined : { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } },
    )
  } catch (error) {
    console.error('[GET_POST_BY_ID_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

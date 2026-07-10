// app/api/store/listings/route.js
//
// Sync endpoint for the store_listings discovery index behind the bazzar/premium feed.
// Clients ping it after a listing or purchase tx confirms; the server re-reads the
// listing onchain (source of truth) before writing, so a request can never fake a
// premium post — see lib/storeListingsIndex.js.

import { NextResponse } from 'next/server'
import { syncListingFromChain } from '@/lib/storeListingsIndex'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    const { postId, networkId } = await request.json()
    const post = Number(postId)
    const network = Number(networkId)

    if (!Number.isInteger(post) || post < 0 || !Number.isInteger(network) || network <= 0) {
      return NextResponse.json({ success: false, error: 'postId and networkId are required' }, { status: 400 })
    }

    const result = await syncListingFromChain(network, post)
    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    console.error('[STORE_LISTING_SYNC_ERROR]:', e.message)
    return NextResponse.json({ success: false, error: 'Failed to sync listing' }, { status: 500 })
  }
}

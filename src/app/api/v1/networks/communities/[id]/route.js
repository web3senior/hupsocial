/**
 * @file api/v1/networks/communities/[id]/route.js
 * @description Fetches a single indexed community by its on-chain id + network, mirroring
 * /api/v1/networks/[networkId]/[postId]'s pattern for post details — this is what lets the
 * community detail page (communities/[networkId]/[communityId]) show correct data regardless of
 * which chain the viewer's wallet happens to be connected to.
 *
 * The query itself lives in lib/communityRows so the detail page's server render can run it
 * directly instead of calling this route over HTTP. What remains here is the browser's path to
 * the same row: the page seeds from a shared, viewer-agnostic copy, then a connected wallet asks
 * here for its own membership standing on top.
 */

import { NextResponse } from 'next/server'
import { fetchCommunityRow } from '@/lib/communityRows'

export const runtime = 'nodejs'

export async function GET(request, { params }) {
  try {
    const { id: communityId } = await params
    const { searchParams } = new URL(request.url)
    const networkId = searchParams.get('network_id')

    if (!networkId) {
      return NextResponse.json({ error: 'network_id is required' }, { status: 400 })
    }

    const community = await fetchCommunityRow({
      networkId,
      communityId,
      contractAddress: searchParams.get('contract_address'),
      viewerAddress: searchParams.get('viewer_address'),
    })

    if (!community) {
      return NextResponse.json({ success: false, error: 'Community not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: community })
  } catch (error) {
    console.error('[COMMUNITY_FETCH_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to fetch community' }, { status: 500 })
  }
}

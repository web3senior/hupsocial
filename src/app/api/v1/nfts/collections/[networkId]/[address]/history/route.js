/**
 * @file api/v1/nfts/collections/[networkId]/[address]/history/route.js
 * @description One collection's daily floor series, over a longer window than the market
 * rail's batch sibling asks for — this is the collection page's floor chart, where the reader
 * came to look at the trend rather than glance at it.
 *
 * Same reconstruction, same currency rule, same caveats as lib/nftFloorHistory — read that
 * file's header before trusting a cancelled listing's end date.
 *
 * Unlike the batch sibling, this one asks for sales too: a reader who came to study the trend
 * wants to know which asks actually cleared, and one collection can afford the second query.
 * The rail draws a dozen sparklines with no room to mark a sale on any of them, so it doesn't.
 */

import { NextResponse } from 'next/server'
import { getFloorHistory } from '@/lib/nftFloorHistory'

export const runtime = 'nodejs'

// The chart offers 7/30/90-day ranges; 30 is what it opens on
const DEFAULT_WINDOW = 30

const CACHE_CONTROL = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600'

export async function GET(request, { params }) {
  try {
    const { networkId, address } = await params
    const { searchParams } = new URL(request.url)

    if (!/^\d+$/.test(String(networkId)) || !/^0x[0-9a-fA-F]{40}$/.test(String(address))) {
      return NextResponse.json(
        { success: false, error: 'A numeric networkId and a collection address are required' },
        { status: 400 },
      )
    }

    const [data] = await getFloorHistory({
      keys: [[Number(networkId), address.toLowerCase()]],
      days: searchParams.get('days') || DEFAULT_WINDOW,
      withSales: true,
    })

    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': CACHE_CONTROL } })
  } catch (error) {
    console.error('[GET_NFT_COLLECTION_HISTORY_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

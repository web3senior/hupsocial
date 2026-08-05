/**
 * @file api/v1/nfts/collections/[networkId]/[address]/route.js
 * @description Collection-level display metadata (name, symbol, banner, description,
 * creators, supply) for one contract, served from the nft_collection_cache read-through
 * cache — the collection page header and the listing page's "about the collection" strip
 * both read from here. The sibling collections/route.js stays the market-wide rollup.
 */

import { NextResponse } from 'next/server'
import { getCollectionMetadata } from '@/lib/collectionMetadataCache'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Collection identity changes rarely; supply during a mint is the freshest thing here and
// the DB row already re-resolves daily, so edge caching stays modest.
const CACHE_CONTROL = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'

export async function GET(request, { params }) {
  try {
    const { networkId, address } = await params
    const { searchParams, origin } = new URL(request.url)

    if (!/^\d+$/.test(String(networkId)) || !/^0x[0-9a-fA-F]{40}$/.test(String(address))) {
      return NextResponse.json({ success: false, error: 'A numeric networkId and a collection address are required' }, { status: 400 })
    }

    // Optional hint from callers that already hold a listing row; absent, the cache infers
    // the standard from the listings index or an onchain probe.
    const isLsp8Param = searchParams.get('isLsp8')
    const isLsp8 = isLsp8Param === null ? null : isLsp8Param === '1'

    const result = await getCollectionMetadata({ chainId: networkId, collection: address, isLsp8, baseUrl: origin })

    if (!result) {
      return NextResponse.json({ success: false, error: 'Unable to resolve the collection' }, { status: 502 })
    }

    return NextResponse.json({ success: true, data: result.metadata }, { headers: { 'Cache-Control': CACHE_CONTROL } })
  } catch (error) {
    console.error('[GET_NFT_COLLECTION_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

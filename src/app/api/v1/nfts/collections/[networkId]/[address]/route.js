/**
 * @file api/v1/nfts/collections/[networkId]/[address]/route.js
 * @description Collection-level display metadata (name, symbol, banner, description,
 * creators, supply) for one contract, served from the nft_collection_cache read-through
 * cache — the collection page header and the listing page's "about the collection" strip
 * both read from here. The sibling collections/route.js stays the market-wide rollup.
 */

import { NextResponse } from 'next/server'
import { getCollectionMetadata, refreshCollectionMetadata } from '@/lib/collectionMetadataCache'
import { getCollectionModelStats } from '@/lib/nftMetadataCache'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Collection identity changes rarely, but this payload is no longer only identity: `models`
// is a rollup of the token cache, which fills in as the app resolves the collection. A
// day-long stale-while-revalidate window let a browser paint a body from before a token's
// 3D file was known — and since a stale hit renders first and revalidates behind it, the
// badge stayed missing for a whole extra page view. Freshness now matches the fastest-moving
// field in the response; the edge still absorbs the RPC-backed part.
const CACHE_CONTROL = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600'

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

    // The collection's identity comes from its own contract; whether it ships 3D is a fact
    // about its tokens, so it is rolled up from the token cache alongside it
    const [result, models] = await Promise.all([
      getCollectionMetadata({ chainId: networkId, collection: address, isLsp8, baseUrl: origin }),
      getCollectionModelStats({ chainId: networkId, collection: address }),
    ])

    if (!result) {
      return NextResponse.json({ success: false, error: 'Unable to resolve the collection' }, { status: 502 })
    }

    return NextResponse.json({ success: true, data: { ...result.metadata, models } }, { headers: { 'Cache-Control': CACHE_CONTROL } })
  } catch (error) {
    console.error('[GET_NFT_COLLECTION_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

/**
 * Force re-read of the collection's identity from chain, for a collection that changed its
 * banner, description or links onchain. Throttled server-side per collection; the token
 * sweep (metadata/refresh/collection) is a separate, heavier endpoint.
 */
export async function POST(request, { params }) {
  try {
    const { networkId, address } = await params
    const { origin } = new URL(request.url)

    if (!/^\d+$/.test(String(networkId)) || !/^0x[0-9a-fA-F]{40}$/.test(String(address))) {
      return NextResponse.json({ success: false, error: 'A numeric networkId and a collection address are required' }, { status: 400 })
    }

    const result = await refreshCollectionMetadata({ chainId: networkId, collection: address, baseUrl: origin })

    if (result.throttled) {
      return NextResponse.json(
        { success: false, error: `Collection was just refreshed — try again in ${result.retryAfterSeconds}s` },
        { status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } },
      )
    }

    if (!result.metadata) {
      return NextResponse.json({ success: false, error: 'Unable to resolve the collection' }, { status: 502 })
    }

    // Same shape as GET — this body is written straight into the client's cache, so a field
    // missing here would blank the badge on every refresh
    const models = await getCollectionModelStats({ chainId: networkId, collection: address })

    return NextResponse.json({ success: true, data: { ...result.metadata, models } })
  } catch (error) {
    console.error('[POST_NFT_COLLECTION_REFRESH_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

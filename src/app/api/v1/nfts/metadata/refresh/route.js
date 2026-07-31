/**
 * @file api/v1/nfts/metadata/refresh/route.js
 * @description Forces one token's metadata to be re-read from chain.
 *
 * A collection that updates its onchain metadata gives us no signal — nothing emits an event
 * we could watch without indexing ERC725Y DataChanged for every collection, which is more
 * weight than this is worth. So the cached row simply lives out its TTL, and the person who
 * just made the change is the one who notices. This endpoint is their escape hatch.
 *
 * Rate limiting comes from the cached row's own timestamp rather than a counter, so it needs
 * no shared state and behaves correctly across instances.
 */

import { NextResponse } from 'next/server'
import { refreshNftMetadata } from '@/lib/nftMetadataCache'
import { toMetadataPayload } from '@/lib/nftMetadataPayload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  const { origin } = new URL(request.url)

  try {
    const body = await request.json()
    const { chainId, collection, tokenId, isLsp8 } = body || {}

    if (!chainId || !collection || tokenId === undefined || tokenId === null || tokenId === '') {
      return NextResponse.json({ success: false, error: 'chainId, collection and tokenId are required' }, { status: 400 })
    }

    const result = await refreshNftMetadata({ chainId, collection, tokenId, isLsp8: Boolean(isLsp8), baseUrl: origin })

    if (result.throttled) {
      return NextResponse.json(
        { success: false, error: 'This NFT was refreshed a moment ago', retryAfterSeconds: result.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } },
      )
    }

    if (!result.metadata) {
      return NextResponse.json({ success: false, error: 'Unable to resolve metadata' }, { status: 502 })
    }

    return NextResponse.json({
      success: true,
      data: toMetadataPayload({ metadata: result.metadata, chainId, collection, tokenId, isLsp8 }),
    })
  } catch (error) {
    console.error('[POST_NFT_METADATA_REFRESH_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

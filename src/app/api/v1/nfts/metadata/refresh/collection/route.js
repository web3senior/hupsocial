/**
 * @file api/v1/nfts/metadata/refresh/collection/route.js
 * @description Forces a whole collection's cached metadata to be re-read from chain — the
 * bulk form of the single-token refresh next door.
 *
 * A collection that re-points its artwork changes every token at once, and clicking through
 * them one at a time is not a real answer. This sweeps the tokens this app has cached for the
 * collection, stalest first.
 *
 * One call is deliberately partial: it takes a bounded batch so the handler always answers
 * inside the platform's timeout, and reports how many stale tokens are left. Callers repeat
 * until `remaining` reaches zero. The rate limit is the same trick the single-token route
 * uses — each row's own fetched_at — so a second caller arriving mid-sweep simply picks up
 * whatever the first one has not reached yet, with no shared state to coordinate.
 */

import { NextResponse } from 'next/server'
import { refreshCollectionMetadata } from '@/lib/nftMetadataCache'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// A batch is two dozen tokens, each an RPC fan-out plus an offchain document fetch — beyond
// the platform default, though well inside this.
export const maxDuration = 60

export async function POST(request) {
  const { origin } = new URL(request.url)

  try {
    const body = await request.json()
    const { chainId, collection } = body || {}

    if (!chainId || !collection) {
      return NextResponse.json({ success: false, error: 'chainId and collection are required' }, { status: 400 })
    }

    const result = await refreshCollectionMetadata({ chainId, collection, baseUrl: origin })

    // Nothing to do is a normal outcome here, not an error: either the collection has nothing
    // cached, or it was swept a moment ago. The counts say which, and the client words it.
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    console.error('[POST_NFT_COLLECTION_METADATA_REFRESH_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

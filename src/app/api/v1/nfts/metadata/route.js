/**
 * @file api/v1/nfts/metadata/route.js
 * @description Display metadata for a single ERC721/LSP8 token, served from the
 * nft_metadata_cache read-through cache so a feed render costs one indexed row lookup
 * instead of five RPC reads per token, per visitor, per session.
 *
 * Artwork that lives inline in the contract never reaches the client as a data URI —
 * it is swapped for a /api/nft/image reference, so the browser gets a cacheable URL
 * instead of hundreds of KB of base64 wedged into the DOM.
 */

import { NextResponse } from 'next/server'
import { getNftMetadata } from '@/lib/nftMetadataCache'
import { toMetadataPayload } from '@/lib/nftMetadataPayload'
import { mapWithConcurrency } from '@/lib/concurrency'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Matches the image proxy: onchain art is mutable, so this is not `immutable`.
const CACHE_CONTROL = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'

/* Resolving a whole grid at once must not open an unbounded number of RPC/gateway
   conversations. A token of a collection already being read now costs one batched RPC read
   and one request to the gateway that served its neighbour, rather than five reads and a
   four-host race, so the same politeness budget buys twice the workers. */
const BATCH_CONCURRENCY = 16
const MAX_BATCH = 60

/**
 * Batch form of the GET below. The market grid resolves ~30 tokens at once, and the dev
 * server speaks HTTP/1.1 — at ~6 connections per origin, 30 separate metadata requests
 * crowd out the image requests behind them and the grid renders blank. One round trip for
 * the whole viewport leaves the connection budget to the images.
 */
export async function POST(request) {
  const { origin } = new URL(request.url)

  try {
    const body = await request.json()
    const tokens = Array.isArray(body?.tokens) ? body.tokens : null

    if (!tokens || tokens.length === 0) {
      return NextResponse.json({ success: false, error: 'tokens[] is required' }, { status: 400 })
    }
    if (tokens.length > MAX_BATCH) {
      return NextResponse.json({ success: false, error: `At most ${MAX_BATCH} tokens per batch` }, { status: 400 })
    }

    const data = await mapWithConcurrency(tokens, BATCH_CONCURRENCY, async (token) => {
      const { chainId, collection, tokenId, isLsp8 } = token || {}
      if (!chainId || !collection || tokenId === undefined || tokenId === null || tokenId === '') return null

      try {
        const result = await getNftMetadata({ chainId, collection, tokenId, isLsp8: Boolean(isLsp8), baseUrl: origin })
        return result ? toMetadataPayload({ metadata: result.metadata, chainId, collection, tokenId, isLsp8 }) : null
      } catch (error) {
        // One bad token must not fail the other 29 — the client renders a placeholder for nulls.
        console.warn('[POST_NFT_METADATA_BATCH] token failed:', error.message)
        return null
      }
    })

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('[POST_NFT_METADATA_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url)

  const chainId = searchParams.get('chainId')
  const collection = searchParams.get('collection')
  const tokenId = searchParams.get('tokenId')
  const isLsp8 = searchParams.get('isLsp8') === '1'

  if (!chainId || !collection || !tokenId) {
    return NextResponse.json({ success: false, error: 'chainId, collection and tokenId are required' }, { status: 400 })
  }

  try {
    const result = await getNftMetadata({ chainId, collection, tokenId, isLsp8, baseUrl: origin })

    if (!result) {
      return NextResponse.json({ success: false, error: 'Unable to resolve metadata' }, { status: 502 })
    }

    return NextResponse.json(
      { success: true, data: toMetadataPayload({ metadata: result.metadata, chainId, collection, tokenId, isLsp8 }) },
      { headers: { 'Cache-Control': CACHE_CONTROL } },
    )
  } catch (error) {
    console.error('[GET_NFT_METADATA_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

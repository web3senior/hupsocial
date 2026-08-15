/**
 * @file api/v1/nfts/collections/[networkId]/[address]/tokens/route.js
 * @description The tokens of one collection this app has seen, for the collection page's
 * whole-collection browse — the fallback source when the contract itself can't enumerate
 * (LSP8 has no global token index, and ERC721Enumerable is optional).
 *
 * "Seen" means a row in nft_metadata_cache: the read-through cache fills in whenever a token
 * is rendered anywhere — a listing card, a trade in a post, the browse grid itself — so this
 * list grows as the collection is used, and the client says so instead of passing it off as
 * the full supply. Rows come back as bare token ids; the tiles resolve name and artwork
 * through the same metadata read-through every other card uses.
 *
 * Each token also carries its live listing when it has one, so a browsed token that is up for
 * sale can badge its price and link to the listing. One active row per token is a contract
 * guarantee — HupTrade escrows the NFT on listing, so it cannot be actively listed twice.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

const DEFAULT_LIMIT = 24
const MAX_LIMIT = 60

// IHupTrade.ListingStatus, as cidex writes it into nft_listings
const STATUS_ACTIVE = 1

// The set almost only ever grows — the one subtraction is a row dropped for having no owner
// onchain — so a minute of staleness costs one late tile, or one lingering ghost, at most
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

    const chainId = Number(networkId)
    const collection = address.toLowerCase()
    const page = Math.max(parseInt(searchParams.get('page')) || 1, 1)
    const limit = Math.min(parseInt(searchParams.get('limit')) || DEFAULT_LIMIT, MAX_LIMIT)
    const offset = (page - 1) * limit

    // LENGTH before value sorts decimal ids numerically ("2" before "10") and leaves the
    // fixed-length bytes32 ids in their natural lexicographic order — which for number-format
    // LSP8 collections is numeric order too
    const [[rows], [[counts]]] = await Promise.all([
      pool.execute(
        `SELECT m.token_id, m.is_lsp8,
                l.listing_id, CAST(l.price AS CHAR) AS price, l.payment_token, l.is_lsp7,
                st.symbol, st.decimals
           FROM nft_metadata_cache m
           LEFT JOIN nft_listings l
             ON l.network_id = m.network_id AND l.collection = m.collection
            AND l.token_id = m.token_id AND l.status = ${STATUS_ACTIVE}
           LEFT JOIN store_tokens st ON st.network_id = l.network_id AND st.token = l.payment_token
          WHERE m.network_id = ? AND m.collection = ?
          ORDER BY LENGTH(m.token_id), m.token_id
          LIMIT ? OFFSET ?`,
        [chainId, collection, limit + 1, offset],
      ),
      pool.execute(`SELECT COUNT(*) AS total FROM nft_metadata_cache WHERE network_id = ? AND collection = ?`, [
        chainId,
        collection,
      ]),
    ])

    const hasMore = rows.length > limit
    const data = (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
      token_id: row.token_id,
      is_lsp8: Number(row.is_lsp8) === 1,
      listing:
        row.listing_id === null
          ? null
          : {
              listing_id: Number(row.listing_id),
              price: row.price,
              payment_token: row.payment_token,
              is_lsp7: Number(row.is_lsp7) === 1,
              // Null for the native coin — store_tokens has no row for it, and the client
              // fills both in from its chain config like every other price in the app
              symbol: row.symbol,
              decimals: row.decimals,
            },
    }))

    return NextResponse.json(
      { success: true, data, meta: { page, hasMore, total: Number(counts?.total) || 0 } },
      { headers: { 'Cache-Control': CACHE_CONTROL } },
    )
  } catch (error) {
    console.error('[GET_NFT_COLLECTION_TOKENS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

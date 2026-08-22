/**
 * @file api/v1/nfts/collections/[networkId]/[address]/offers/route.js
 * @description The best live offer on each token of one collection — the Top offer column on
 * the collection page's table view.
 *
 * The offers list route answers "the offers on this asset", one asset at a time; a table of
 * two dozen rows would ask it two dozen times. This answers the same question for a whole
 * collection in one query, and only for what a buyer can act on: status Active and not yet
 * expired, the same definition the offers page uses.
 *
 * Currency rule follows the floor's: an offer in another payment token is not silently ranked
 * against one in the collection's dominant token, because "higher" between two currencies is
 * a number nobody can defend. Each token's best offer is picked within one currency, the
 * collection's dominant one where it has offers in it, and the row carries the symbol it was
 * quoted in so the cell can never mislabel it.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

// IHupOffers.OfferStatus — the only state that can still be filled
const OFFER_STATUS_ACTIVE = 1

// Offers arrive and expire by the minute, so this is a short-lived answer — shorter than the
// floor's, which only moves when somebody lists
const CACHE_CONTROL = 'public, max-age=15, s-maxage=60, stale-while-revalidate=300'

export async function GET(request, { params }) {
  try {
    const { networkId, address } = await params

    if (!/^\d+$/.test(String(networkId)) || !/^0x[0-9a-fA-F]{40}$/.test(String(address))) {
      return NextResponse.json(
        { success: false, error: 'A numeric networkId and a collection address are required' },
        { status: 400 },
      )
    }

    const collection = String(address).toLowerCase()

    // Grouped by currency as well as token: the highest price *within* a payment token is a
    // fact, the highest across them is not. DECIMAL(65,0) because prices are base units in a
    // string column — MAX() on the raw text would rank "9" above "10".
    const [rows] = await pool.execute(
      `SELECT o.token_id,
              o.payment_token,
              CAST(MAX(CAST(o.price AS DECIMAL(65,0))) AS CHAR) AS price,
              COUNT(*) AS offers,
              st.symbol,
              st.decimals
         FROM nft_offers o
         LEFT JOIN store_tokens st
           ON st.network_id = o.network_id AND st.token = o.payment_token
        WHERE o.network_id = ? AND o.collection = ?
          AND o.status = ? AND o.expires_at > UNIX_TIMESTAMP()
        GROUP BY o.token_id, o.payment_token, st.symbol, st.decimals`,
      [Number(networkId), collection, OFFER_STATUS_ACTIVE],
    )

    // Whichever currency the collection's bidders mostly use. Ties break on the first row,
    // which is stable enough for a tiebreak nobody can see.
    const byCurrency = new Map()
    for (const row of rows) {
      byCurrency.set(row.payment_token, (byCurrency.get(row.payment_token) || 0) + Number(row.offers))
    }
    const dominant = [...byCurrency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

    // One row per token: its best offer in the dominant currency, or — for a token nobody has
    // bid on in that currency — its best in whichever currency it does have offers in
    const best = new Map()
    for (const row of rows) {
      const current = best.get(row.token_id)
      if (!current) {
        best.set(row.token_id, row)
        continue
      }
      if (current.payment_token === dominant) continue
      if (row.payment_token === dominant || Number(row.offers) > Number(current.offers)) best.set(row.token_id, row)
    }

    const data = [...best.values()].map((row) => ({
      token_id: row.token_id,
      price: row.price,
      payment_token: row.payment_token,
      // Null for the native coin — store_tokens has no row for it, so the client fills both
      // in from its chain config, like every other price in the app
      symbol: row.symbol,
      decimals: row.decimals === null ? null : Number(row.decimals),
      offers: Number(row.offers),
    }))

    return NextResponse.json(
      {
        success: true,
        data,
        meta: {
          tokens: data.length,
          currencies: byCurrency.size,
          dominant,
        },
      },
      { headers: { 'Cache-Control': CACHE_CONTROL } },
    )
  } catch (error) {
    console.error('[GET_NFT_COLLECTION_OFFERS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

/**
 * @file api/v1/nfts/collections/route.js
 * @description Collection-level rollup of the cidex-indexed nft_listings table, powering the
 * NFT Market hero. Returns the collections with live listings — how many are active, how many
 * already sold, the floor, and a few sample token ids the client resolves artwork from.
 *
 * Collection names and images are NOT indexed (they come from a live per-token read, same as
 * the grid cards), which is why sample token ids ship instead of a name/image.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { BACKED_LISTINGS_SQL } from '@/lib/nftListingBacking'

export const runtime = 'nodejs'

const SAMPLES_PER_COLLECTION = 3

/**
 * Floor price per collection, priced in a single currency.
 *
 * Listings in one collection can be priced in different tokens, and MIN() across them would
 * compare 1 ETH against 1 USDC. So the floor is taken within each payment token and the token
 * carrying the most active listings wins — the floor a buyer actually sees on the shelf.
 */
async function attachFloors(rows) {
  const keys = rows.map((r) => [r.network_id, r.collection])
  const [groups] = await pool.execute(
    `SELECT l.network_id, l.collection, l.payment_token, l.is_lsp7, COUNT(*) AS token_count,
            CAST(MIN(CAST(l.price AS DECIMAL(65,0))) AS CHAR) AS floor_price,
            st.symbol, st.decimals
       FROM nft_listings l
       LEFT JOIN store_tokens st ON st.network_id = l.network_id AND st.token = l.payment_token
      WHERE l.status = 1 AND l.backed = 1 AND (l.network_id, l.collection) IN (${keys.map(() => '(?,?)').join(',')})
      GROUP BY l.network_id, l.collection, l.payment_token, l.is_lsp7, st.symbol, st.decimals
      ORDER BY token_count DESC`,
    keys.flat(),
  )

  // Sorted by popularity, so the first group per collection is its dominant currency
  const dominant = new Map()
  for (const group of groups) {
    const key = `${group.network_id}-${group.collection}`
    if (!dominant.has(key)) dominant.set(key, group)
  }

  for (const row of rows) {
    const group = dominant.get(`${row.network_id}-${row.collection}`)
    if (!group) continue
    row.floor_price = group.floor_price
    row.floor_token = group.payment_token
    row.floor_symbol = group.symbol
    row.floor_decimals = group.decimals
  }
}

/**
 * A handful of recent token ids per collection for the hero's cover mosaic. Ranked in SQL
 * rather than fetched per collection so it stays one round trip however many collections show.
 */
async function attachSamples(rows) {
  const keys = rows.map((r) => [r.network_id, r.collection])
  const [samples] = await pool.execute(
    `SELECT network_id, collection, token_id, is_lsp8
       FROM (
         SELECT l.network_id, l.collection, l.token_id, l.is_lsp8,
                ROW_NUMBER() OVER (PARTITION BY l.network_id, l.collection ORDER BY l.listed_at DESC) AS rn
           FROM nft_listings l
          WHERE l.status = 1 AND l.backed = 1 AND (l.network_id, l.collection) IN (${keys.map(() => '(?,?)').join(',')})
       ) ranked
      WHERE rn <= ?`,
    [...keys.flat(), SAMPLES_PER_COLLECTION],
  )

  const byCollection = new Map()
  for (const sample of samples) {
    const key = `${sample.network_id}-${sample.collection}`
    if (!byCollection.has(key)) byCollection.set(key, [])
    byCollection.get(key).push({ token_id: sample.token_id, is_lsp8: sample.is_lsp8 })
  }

  for (const row of rows) {
    row.samples = byCollection.get(`${row.network_id}-${row.collection}`) || []
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit')) || 12, 24)
    const networkId = searchParams.get('networkId')

    let whereClause = ` WHERE l.status IN (1, 2) AND ${BACKED_LISTINGS_SQL}`
    const whereParams = []

    if (networkId) {
      whereClause += ` AND l.network_id = ?`
      whereParams.push(networkId)
    }

    // Sold rows come along for the "N sold" stat, but a collection only earns a hero slot
    // while something is still buyable — hence the HAVING on the active count.
    const [rows] = await pool.execute(
      `SELECT l.network_id, l.collection, MAX(l.is_lsp8) AS is_lsp8,
              SUM(l.status = 1) AS active_count,
              SUM(l.status = 2) AS sold_count,
              MAX(l.listed_at) AS last_listed_at
         FROM nft_listings l
         ${whereClause}
        GROUP BY l.network_id, l.collection
       HAVING active_count > 0
        ORDER BY active_count DESC, last_listed_at DESC
        LIMIT ?`,
      [...whereParams, limit],
    )

    if (rows.length) {
      await attachFloors(rows)
      await attachSamples(rows)
    }

    return NextResponse.json({ success: true, data: rows })
  } catch (error) {
    console.error('[GET_NFT_COLLECTIONS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

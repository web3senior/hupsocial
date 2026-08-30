/**
 * @file api/v1/nfts/collections/ranking/route.js
 * @description The collections leaderboard behind the NFT Market's Collections view: one row
 * per collection with everything a trader ranks them by — floor, best live offer, 24h volume
 * and how that moved, 24h sales, lifetime volume, supply and how much of it is listed.
 *
 * Separate from collections/route.js on purpose. That one answers "which collections have
 * something on the shelf" for the hero rail and is ordered by listing count; this one has to
 * compute every stat BEFORE it can order, because sorting by 24h volume after taking the top
 * N by listings would rank a page, not a market.
 *
 * Currency rule is the one the floor already follows (collections/route.js, stats/route.js):
 * a collection can trade, list and take bids in several payment tokens, and MIN/SUM across
 * them would compare 1 ETH against 1 USDC. So each of the three — floor, volume, best offer —
 * is computed within a payment token and the token carrying the most rows wins, with the
 * symbol shipped alongside so no cell can mislabel what it quotes. Sorting by a
 * currency-denominated column across networks therefore ranks unlike numbers; the table says
 * so in the column's tooltip rather than pretending otherwise.
 *
 * Native-coin rows come back with null symbol/decimals — store_tokens has no row for a
 * chain's own currency — and the client fills both from its chain config, same as the floor
 * chart and the hero cards.
 *
 * Every figure here is read from what cidex indexed (nft_listings, nft_trades, nft_offers,
 * nft_collection_cache); nothing on the way to the response touches a chain. The one thing
 * that does is the identity backfill below, and it runs after the response — a collection
 * with no cached name used to be read from chain by the browser instead, once per nameless
 * row, which is a page of RPC round trips for a table that is otherwise a single query.
 */

import { NextResponse, after } from 'next/server'
import pool from '@/lib/db'
import { getCollectionMetadata } from '@/lib/collectionMetadataCache'

export const runtime = 'nodejs'

const DAY_SECONDS = 86400
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

// IHupOffers.OfferStatus — the only state that can still be filled
const OFFER_STATUS_ACTIVE = 1

/**
 * Sortable columns, as ORDER BY fragments. A whitelist rather than interpolation of whatever
 * arrives: the value lands in the SQL text, so nothing outside this map can ever reach it.
 *
 * `x IS NULL, x DESC` puts unknowns last in MariaDB — a collection nobody has bid on belongs
 * at the bottom of a bid ranking, not the top where a NULL would otherwise sort.
 */
const SORTS = {
  volume24h: 'COALESCE(tr.volume_24h, 0) DESC',
  volumeTotal: 'COALESCE(tr.volume_total, 0) DESC',
  sales24h: 'COALESCE(tr.sales_24h, 0) DESC',
  change24h: 'change_24h IS NULL, change_24h DESC',
  floor: 'fl.floor_price IS NULL, fl.floor_price DESC',
  bestOffer: 'ofr.best_offer IS NULL, ofr.best_offer DESC',
  marketCap: 'market_cap IS NULL, market_cap DESC',
  listed: 'COALESCE(li.active_count, 0) DESC',
  supply: 'supply IS NULL, supply DESC',
}

const DEFAULT_SORT = 'volume24h'

// Ranks reshuffle only as fast as trades and listings land, and the table is a scan-and-click
// surface — half a minute of staleness costs a reader nothing and saves the whole rollup
const CACHE_CONTROL = 'public, max-age=30, s-maxage=120, stale-while-revalidate=600'

/**
 * How many unnamed collections one request will go and read. nft_collection_cache is filled
 * read-through, so a collection listed for the first time has no row until something resolves
 * it — and the table used to be that something, one browser fetch per nameless row.
 *
 * Kept small deliberately. This is a repair, not a sweep: every request takes a few more off
 * the pile and the next one prints them from the database, so a market whose whole index is
 * cold fills in over a handful of page views rather than in one RPC storm.
 */
const IDENTITY_BACKFILL_LIMIT = 4

/**
 * Reads the identities the ranking couldn't print, after the response has gone out.
 *
 * getCollectionMetadata writes what it resolves into nft_collection_cache, so the work is
 * paid once for every later reader — which is the whole point of doing it here instead of in
 * the browser. A row that stays unresolved is left to its own negative TTL; nothing here
 * retries, and nothing here can slow the ranking down, because `after` runs once the JSON is
 * already on its way.
 * @param {Array<Object>} rows The ranking rows, as the query returned them.
 * @param {string} origin Absolute origin, for resolving proxy-relative storage URLs.
 */
function backfillIdentities(rows, origin) {
  const nameless = rows.filter((row) => !row.name).slice(0, IDENTITY_BACKFILL_LIMIT)
  if (!nameless.length) return

  after(async () => {
    await Promise.allSettled(
      nameless.map((row) =>
        getCollectionMetadata({
          chainId: row.network_id,
          collection: row.collection,
          isLsp8: Boolean(Number(row.is_lsp8)),
          baseUrl: origin,
        }),
      ),
    )
  })
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)

    const limit = Math.min(parseInt(searchParams.get('limit')) || DEFAULT_LIMIT, MAX_LIMIT)
    const sort = SORTS[searchParams.get('sort')] ? searchParams.get('sort') : DEFAULT_SORT

    const networkParam = searchParams.get('networkId')
    const networkId = /^\d+$/.test(String(networkParam)) ? Number(networkParam) : null

    // Repeated verbatim in every CTE that scans a raw table, so a chain-filtered request
    // narrows the aggregates themselves rather than only the rows that survive the join
    const chain = networkId ? ' AND network_id = ?' : ''
    const chainParam = networkId ? [networkId] : []

    const now = Math.floor(Date.now() / 1000)
    const since24 = now - DAY_SECONDS
    const since48 = now - DAY_SECONDS * 2

    const [rows] = await pool.execute(
      `WITH
        listing_totals AS (
          SELECT network_id, collection, MAX(is_lsp8) AS is_lsp8,
                 COUNT(*) AS active_count, MAX(listed_at) AS last_listed_at
            FROM nft_listings
           WHERE status = 1 AND backed = 1${chain}
           GROUP BY network_id, collection
        ),
        floor_by_token AS (
          SELECT network_id, collection, payment_token,
                 MIN(price) AS floor_price, COUNT(*) AS token_count
            FROM nft_listings
           WHERE status = 1 AND backed = 1${chain}
           GROUP BY network_id, collection, payment_token
        ),
        floor_dominant AS (
          SELECT * FROM (
            SELECT f.*, ROW_NUMBER() OVER (PARTITION BY network_id, collection ORDER BY token_count DESC) AS rn
              FROM floor_by_token f
          ) ranked WHERE rn = 1
        ),
        offer_by_token AS (
          SELECT network_id, collection, payment_token,
                 MAX(price) AS best_offer, COUNT(*) AS offer_count
            FROM nft_offers
           WHERE status = ? AND expires_at > UNIX_TIMESTAMP()${chain}
           GROUP BY network_id, collection, payment_token
        ),
        offer_dominant AS (
          SELECT * FROM (
            SELECT o.*, ROW_NUMBER() OVER (PARTITION BY network_id, collection ORDER BY offer_count DESC) AS rn
              FROM offer_by_token o
          ) ranked WHERE rn = 1
        ),
        trade_by_token AS (
          SELECT network_id, collection, payment_token, MAX(is_lsp8) AS is_lsp8,
                 SUM(CASE WHEN sold_at >= ? THEN price ELSE 0 END) AS volume_24h,
                 SUM(CASE WHEN sold_at >= ? AND sold_at < ? THEN price ELSE 0 END) AS volume_prev_24h,
                 SUM(price) AS volume_total,
                 SUM(sold_at >= ?) AS sales_24h,
                 COUNT(*) AS sales_total
            FROM nft_trades
           WHERE 1 = 1${chain}
           GROUP BY network_id, collection, payment_token
        ),
        trade_dominant AS (
          SELECT * FROM (
            SELECT t.*, ROW_NUMBER() OVER (PARTITION BY network_id, collection ORDER BY sales_total DESC) AS rn
              FROM trade_by_token t
          ) ranked WHERE rn = 1
        ),
        candidates AS (
          SELECT network_id, collection FROM listing_totals
          UNION
          SELECT network_id, collection FROM trade_dominant
        )
      SELECT c.network_id, c.collection,
             COALESCE(li.is_lsp8, tr.is_lsp8, 0) AS is_lsp8,
             COALESCE(li.active_count, 0) AS active_count,
             li.last_listed_at,
             cc.name, cc.icon_uri, cc.banner_uri,
             cc.total_supply,
             fl.payment_token AS floor_token,
             CAST(fl.floor_price AS CHAR) AS floor_price,
             fst.symbol AS floor_symbol, fst.decimals AS floor_decimals,
             ofr.payment_token AS offer_token,
             CAST(ofr.best_offer AS CHAR) AS best_offer,
             COALESCE(ofr.offer_count, 0) AS offer_count,
             ost.symbol AS offer_symbol, ost.decimals AS offer_decimals,
             tr.payment_token AS volume_token,
             CAST(tr.volume_24h AS CHAR) AS volume_24h,
             CAST(tr.volume_prev_24h AS CHAR) AS volume_prev_24h,
             CAST(tr.volume_total AS CHAR) AS volume_total,
             COALESCE(tr.sales_24h, 0) AS sales_24h,
             COALESCE(tr.sales_total, 0) AS sales_total,
             vst.symbol AS volume_symbol, vst.decimals AS volume_decimals,
             CASE WHEN tr.volume_prev_24h > 0
                  THEN (tr.volume_24h - tr.volume_prev_24h) / tr.volume_prev_24h
             END AS change_24h,
             CAST(cc.total_supply AS DECIMAL(65,0)) AS supply,
             fl.floor_price * CAST(cc.total_supply AS DECIMAL(65,0)) AS market_cap
        FROM candidates c
        LEFT JOIN listing_totals li ON li.network_id = c.network_id AND li.collection = c.collection
        LEFT JOIN floor_dominant fl ON fl.network_id = c.network_id AND fl.collection = c.collection
        LEFT JOIN offer_dominant ofr ON ofr.network_id = c.network_id AND ofr.collection = c.collection
        LEFT JOIN trade_dominant tr ON tr.network_id = c.network_id AND tr.collection = c.collection
        LEFT JOIN nft_collection_cache cc ON cc.network_id = c.network_id AND cc.collection = c.collection
        LEFT JOIN store_tokens fst ON fst.network_id = c.network_id AND fst.token = fl.payment_token
        LEFT JOIN store_tokens ost ON ost.network_id = c.network_id AND ost.token = ofr.payment_token
        LEFT JOIN store_tokens vst ON vst.network_id = c.network_id AND vst.token = tr.payment_token
       ORDER BY ${SORTS[sort]}, COALESCE(li.active_count, 0) DESC, li.last_listed_at DESC
       LIMIT ?`,
      [
        ...chainParam, // listing_totals
        ...chainParam, // floor_by_token
        OFFER_STATUS_ACTIVE,
        ...chainParam, // offer_by_token
        since24,
        since48,
        since24,
        since24,
        ...chainParam, // trade_by_token
        limit,
      ],
    )

    // Ordering columns are an implementation detail of the ORDER BY — market cap and supply
    // are recomputed client-side in BigInt, where the exact figure matters, and shipping a
    // second rounded copy only invites a cell reading from the wrong one
    for (const row of rows) {
      delete row.supply
      delete row.market_cap
    }

    backfillIdentities(rows, new URL(request.url).origin)

    return NextResponse.json({ success: true, sort, data: rows }, { headers: { 'Cache-Control': CACHE_CONTROL } })
  } catch (error) {
    console.error('[GET_NFT_COLLECTION_RANKING_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

/**
 * @file api/v1/nfts/collections/[networkId]/[address]/traits/route.js
 * @description Trait facets for one collection — the option list behind the collection page's
 * attribute filter, and the rarity/floor figures on the token detail panel's trait cards.
 *
 * Traits are not log-derived, so cidex has nothing to index here: they arrive inside a token's
 * metadata document and land in nft_metadata_cache the first time that token is rendered. This
 * route reads that cache. `meta` reports how much of the collection it covers, so the UI can
 * say so rather than pass a sample off as the whole drop.
 *
 * Two scopes, because the filter panel and the trait cards are asking different questions:
 *
 *   scope=listed (default) — tokens carrying a listing in the requested status. What the
 *     filter panel needs: a facet the grid can't show anything for is a dead end, not a filter.
 *
 *   scope=collection — every cached token of the collection, listed or not. What a rarity
 *     share needs: "52% have Hide" is a claim about the drop, and computing it over the few
 *     tokens that happen to be for sale would make it a claim about the shelf instead.
 *
 * `floor=1` adds the lowest live ask among the tokens carrying each value — the "cheapest one
 * with this trait" a buyer is actually after. Same currency rule as every other floor in the
 * app: one payment token, the collection's dominant one, because the lowest of an ETH ask and
 * a USDC ask is not a number anyone can defend. `meta.floor` names the currency it was taken in.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { BACKED_LISTINGS_SQL } from '@/lib/nftListingBacking'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Same keys the listings route takes, so the panel and the grid always agree on what
// "this view" means — including that cancelled (3) is never one of them
const STATUS_BY_KEY = { active: [1], sold: [2], active_sold: [1, 2], all: [1, 2] }

// IHupTrade.ListingStatus — only a live ask can be a floor
const LISTING_STATUS_ACTIVE = 1

// A ceiling on how many cached tokens one call reads. Attributes are longtext, so an
// unbounded scan of a large collection would pull megabytes to build a filter panel; past
// this the counts are a sample and `meta.truncated` says so.
const SCAN_LIMIT = 4000

// Collections that mint free-form traits (dates, serial numbers, wallet addresses) produce a
// value list nobody can filter with. Keep the busiest values and drop the tail.
const MAX_VALUES_PER_LABEL = 200

// Facets change as tokens resolve into the cache, so this is a short-lived answer
const CACHE_CONTROL = 'public, max-age=30, s-maxage=120, stale-while-revalidate=600'

const COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

// Separator for the seen-pair key. A tab can't appear in either half after the trim below,
// so "a<TAB>b" + "c" can never collide with "a" + "b<TAB>c".
const PAIR_SEPARATOR = '\t'

/**
 * Roll a batch of cached attribute documents up into [{label, values: [{value, count, floor}]}].
 *
 * Counts are per token: a document that repeats the same pair (some collections list a trait
 * twice) still counts once. `floor` is the lowest ask among the tokens carrying that pair —
 * null for a value nothing is listed under, and absent entirely when the caller didn't ask for
 * floors. Prices are base units in a decimal string, so the comparison runs in BigInt: Number
 * would round a wei-denominated ask into the wrong order.
 * @param {Array<{attributes: string, price?: string|null}>} rows
 * @param {boolean} withFloor
 */
function buildFacets(rows, withFloor) {
  const groups = new Map()

  for (const row of rows) {
    let attributes
    try {
      attributes = JSON.parse(row.attributes)
    } catch {
      // A malformed document is one token's problem, not the panel's
      continue
    }
    if (!Array.isArray(attributes)) continue

    let price = null
    if (withFloor && row.price !== null && row.price !== undefined) {
      try {
        price = BigInt(row.price)
      } catch {
        price = null
      }
    }

    const seen = new Set()
    for (const attr of attributes) {
      const label = typeof attr?.label === 'string' ? attr.label.trim() : ''
      const value = attr?.value === null || attr?.value === undefined ? '' : String(attr.value).trim()
      if (!label || !value) continue

      const pair = `${label}${PAIR_SEPARATOR}${value}`
      if (seen.has(pair)) continue
      seen.add(pair)

      let values = groups.get(label)
      if (!values) {
        values = new Map()
        groups.set(label, values)
      }

      const entry = values.get(value)
      if (entry) {
        entry.count += 1
        if (price !== null && (entry.floor === null || price < entry.floor)) entry.floor = price
      } else {
        values.set(value, { count: 1, floor: price })
      }
    }
  }

  return [...groups.entries()]
    .map(([label, values]) => ({
      label,
      values: [...values.entries()]
        .map(([value, entry]) => ({
          value,
          count: entry.count,
          ...(withFloor ? { floor: entry.floor === null ? null : entry.floor.toString() } : null),
        }))
        .sort((a, b) => b.count - a.count || COLLATOR.compare(a.value, b.value))
        .slice(0, MAX_VALUES_PER_LABEL),
    }))
    .sort((a, b) => COLLATOR.compare(a.label, b.label))
}

/**
 * The payment token this collection's live asks are mostly quoted in, with its symbol and
 * decimals. Every trait floor is taken within it, so the cards can never rank two currencies
 * against each other.
 * @returns {Promise<{payment_token: string, symbol: string|null, decimals: number|null}|null>}
 * Null when nothing is listed.
 */
async function dominantCurrency(networkId, collection) {
  const [rows] = await pool.execute(
    `SELECT l.payment_token, COUNT(*) AS listings, st.symbol, st.decimals
       FROM nft_listings l
       LEFT JOIN store_tokens st ON st.network_id = l.network_id AND st.token = l.payment_token
      WHERE l.network_id = ? AND l.collection = ? AND l.status = ? AND ${BACKED_LISTINGS_SQL}
      GROUP BY l.payment_token, st.symbol, st.decimals
      ORDER BY listings DESC
      LIMIT 1`,
    [networkId, collection, LISTING_STATUS_ACTIVE],
  )

  const row = rows[0]
  if (!row) return null

  return {
    payment_token: row.payment_token,
    // Null for the native coin — store_tokens has no row for it, and the client fills both in
    // from its chain config like every other price in the app
    symbol: row.symbol ?? null,
    decimals: row.decimals === null || row.decimals === undefined ? null : Number(row.decimals),
  }
}

export async function GET(request, { params }) {
  try {
    const { networkId, address } = await params
    const { searchParams } = new URL(request.url)

    if (!/^\d+$/.test(String(networkId)) || !/^0x[0-9a-fA-F]{40}$/.test(String(address))) {
      return NextResponse.json({ success: false, error: 'A numeric networkId and a collection address are required' }, { status: 400 })
    }

    const collection = String(address).toLowerCase()
    const statuses = STATUS_BY_KEY[searchParams.get('status')] || STATUS_BY_KEY.active
    const placeholders = statuses.map(() => '?').join(',')
    const wholeCollection = searchParams.get('scope') === 'collection'
    const wantsFloor = searchParams.get('floor') === '1'

    const currency = wantsFloor ? await dominantCurrency(networkId, collection) : null
    // Asked for floors on a collection nothing is listed under: the join has nothing to
    // contribute, so it is dropped and every value comes back with a null floor
    const withFloor = Boolean(wantsFloor && currency)

    // The floor side, as a grouped derived table rather than a select-list subquery: MariaDB
    // would run a correlated subquery once per scanned row, and this scan is thousands of rows
    // wide (see lib/db notes on the posts feed for the same trap).
    const floorJoin = withFloor
      ? `LEFT JOIN (
             SELECT l.token_id, CAST(MIN(l.price) AS CHAR) AS price
               FROM nft_listings l
              WHERE l.network_id = ? AND l.collection = ? AND l.status = ? AND ${BACKED_LISTINGS_SQL}
                AND l.payment_token = ?
              GROUP BY l.token_id
           ) f ON f.token_id = m.token_id`
      : ''
    const floorParams = withFloor ? [networkId, collection, LISTING_STATUS_ACTIVE, currency.payment_token] : []

    // scope=listed keeps the listing check as an EXISTS against nft_listings' idx_token, driven
    // from the cache's primary key — the reverse order would scan every listing to find the few
    // that have metadata. scope=collection drops the check entirely.
    const listedFilter = wholeCollection
      ? ''
      : `AND EXISTS (
             SELECT 1 FROM nft_listings l
              WHERE l.network_id = m.network_id AND l.collection = m.collection
                AND l.token_id = m.token_id AND l.status IN (${placeholders}) AND ${BACKED_LISTINGS_SQL}
           )`

    // How much of what the grid can show is actually described by the facets below. The two
    // numbers differ for every token nobody has rendered yet — its traits are unknown, so
    // filtering would hide it, and the panel has to be able to admit that. Collection scope
    // keeps both fields meaningful: `resolved` is how many tokens the cache holds, `listed`
    // how many of the whole collection currently carry a live ask.
    const countsQuery = wholeCollection
      ? pool.execute(
          `SELECT (SELECT COUNT(*) FROM nft_metadata_cache m
                    WHERE m.network_id = ? AND m.collection = ?) AS resolved,
                  (SELECT COUNT(DISTINCT l.token_id) FROM nft_listings l
                    WHERE l.network_id = ? AND l.collection = ? AND l.status = ? AND ${BACKED_LISTINGS_SQL}) AS listed`,
          [networkId, collection, networkId, collection, LISTING_STATUS_ACTIVE],
        )
      : pool.execute(
          `SELECT COUNT(DISTINCT l.token_id) AS listed,
                  COUNT(DISTINCT m.token_id) AS resolved
             FROM nft_listings l
             LEFT JOIN nft_metadata_cache m
               ON m.network_id = l.network_id AND m.collection = l.collection AND m.token_id = l.token_id
            WHERE l.network_id = ? AND l.collection = ? AND l.status IN (${placeholders}) AND ${BACKED_LISTINGS_SQL}`,
          [networkId, collection, ...statuses],
        )

    const [[[counts]], [rows]] = await Promise.all([
      countsQuery,
      pool.execute(
        `SELECT m.attributes${withFloor ? ', f.price' : ''}
           FROM nft_metadata_cache m
           ${floorJoin}
          WHERE m.network_id = ? AND m.collection = ?
            AND m.attributes IS NOT NULL AND m.attributes <> '[]'
            ${listedFilter}
          LIMIT ?`,
        [...floorParams, networkId, collection, ...(wholeCollection ? [] : statuses), SCAN_LIMIT],
      ),
    ])

    return NextResponse.json(
      {
        success: true,
        data: buildFacets(rows, withFloor),
        meta: {
          scope: wholeCollection ? 'collection' : 'listed',
          listed: Number(counts?.listed) || 0,
          resolved: Number(counts?.resolved) || 0,
          // The denominator every count above is out of. Deliberately the scanned rows rather
          // than the collection's supply: a share has to be internally consistent with the
          // sample it was taken from, and `truncated` is what warns that the sample is partial.
          scanned: rows.length,
          // The currency the floors are quoted in, or null when none were asked for or nothing
          // is listed. Never omit it — a bare number here would be a price with no unit.
          floor: withFloor ? currency : null,
          truncated: rows.length >= SCAN_LIMIT,
        },
      },
      { headers: { 'Cache-Control': CACHE_CONTROL } },
    )
  } catch (error) {
    console.error('[GET_NFT_COLLECTION_TRAITS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

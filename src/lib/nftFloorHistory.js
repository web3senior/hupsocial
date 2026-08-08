/**
 * @file lib/nftFloorHistory.js
 * @description Daily floor-price series per collection, rebuilt from the cidex-indexed
 * nft_listings + nft_trades tables. Shared by the market rail's card sparklines and the
 * collection page's floor chart so both quote the same number under the same rule.
 *
 * Nothing snapshots the floor, so a past day's floor is reconstructed from which listings
 * were live that day. A listing is live over [listed_at, endsAt), where endsAt is:
 *   sold      → nft_trades.sold_at            (exact — an onchain event timestamp)
 *   active    → open-ended                    (exact)
 *   cancelled → nft_listings.updated_at       (approximate)
 * Only the cancelled case is approximate: no cancel timestamp is indexed anywhere, so the
 * indexer's own write time stands in. cidex runs continuously, so in normal operation that
 * lands within one poll of the real event — but a backfilled range would date every
 * cancellation to the backfill instead of to the chain.
 *
 * With `withSales`, the same window also comes back as what actually *cleared* — daily sale
 * prices from nft_trades. Floor and sales are different measures and neither substitutes for
 * the other: the floor is the cheapest open ask (forward-looking, what you could buy at), a
 * sale is a settled trade (backward-looking, what someone paid). The collection page draws
 * sales as discrete markers over the floor line; the market rail's sparkline never asks for
 * them, so the flag defaults off and its batch query is unchanged.
 */

import pool from './db'

const DAY_SECONDS = 86400

export const DEFAULT_DAYS = 30
export const MAX_DAYS = 180
const MIN_DAYS = 2

// IHupTrade.ListingStatus, as cidex writes it into nft_listings
const STATUS_ACTIVE = 1

/** UTC midnight of the day a unix timestamp falls in. */
const dayStart = (seconds) => Math.floor(seconds / DAY_SECONDS) * DAY_SECONDS

/** 'YYYY-MM-DD' for a unix timestamp, always UTC — buckets must not shift with server timezone. */
const dayKey = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 10)

/**
 * The single currency a collection's floor is quoted in.
 *
 * One collection's listings can be priced in different tokens, and MIN() across them would
 * compare 1 ETH against 1 USDC — the same trap collections/route.js sidesteps. The token
 * carrying the most *active* listings wins, which is the rule the market rail's floor number
 * already follows, so a card's sparkline can never end up in a different currency than the
 * floor printed beside it. A collection with nothing live falls back to whichever token holds
 * the most listings in the window.
 *
 * @param {Array<Object>} rows Priced rows carrying `payment_token` and, for listings, `status`.
 * Trade rows have no status, so their tally never scores an "active" and the count of rows
 * decides — which is what picking a currency off sales alone should mean anyway.
 */
function dominantToken(rows) {
  const tally = new Map()

  for (const row of rows) {
    const entry = tally.get(row.payment_token) || { active: 0, total: 0, row }
    if (row.status === STATUS_ACTIVE) entry.active += 1
    entry.total += 1
    tally.set(row.payment_token, entry)
  }

  let best = null
  for (const entry of tally.values()) {
    if (!best || entry.active > best.active || (entry.active === best.active && entry.total > best.total)) best = entry
  }
  return best?.row || null
}

/**
 * One floor per calendar day: the cheapest listing that was live at any point in the day.
 * A day with nothing live gets a null rather than a carried-forward price — "nobody was
 * selling" is a fact about the collection, not a gap to be smoothed over.
 */
function buildSeries(listings, buckets) {
  return buckets.map((start) => {
    const end = start + DAY_SECONDS
    let floor = null

    for (const listing of listings) {
      if (listing.listed_at >= end) continue
      if (listing.endsAt !== null && listing.endsAt <= start) continue
      const price = BigInt(listing.price)
      if (floor === null || price < floor) floor = price
    }

    return { date: dayKey(start), floor: floor === null ? null : floor.toString() }
  })
}

/**
 * Sales collapsed to one entry per calendar day. Only days that had a trade appear — unlike
 * the floor, which carries a point for every bucket, a sale is an event and the days without
 * one are not gaps to be filled.
 *
 * The x axis is day-bucketed, so two sales on one day would land on the same tick: the marker
 * plots the day's mean, and `count`/`low`/`high` ride along so a busy day is never silently
 * flattened to a single number in the tooltip. Averaged in BigInt — wei-scale prices overflow
 * a Number long before they reach the client.
 */
function buildSaleSeries(sales) {
  const byDay = new Map()

  for (const sale of sales) {
    const date = dayKey(sale.sold_at)
    const price = BigInt(sale.price)
    const entry = byDay.get(date) || { date, count: 0, sum: 0n, low: price, high: price, trades: [] }

    entry.count += 1
    entry.sum += price
    if (price < entry.low) entry.low = price
    if (price > entry.high) entry.high = price
    // The individual settlements behind the day's aggregate, so a marker can link back to
    // the NFT that traded rather than dead-ending on an average
    entry.trades.push({ listing_id: sale.listing_id, token_id: sale.token_id, price: sale.price, sold_at: sale.sold_at })
    byDay.set(date, entry)
  }

  // Rows arrive ordered by sold_at and Map keeps insertion order, so this comes out chronological
  return Array.from(byDay.values(), ({ date, count, sum, low, high, trades }) => ({
    date,
    count,
    avg: (sum / BigInt(count)).toString(),
    low: low.toString(),
    high: high.toString(),
    trades,
  }))
}

/**
 * Percent move from the window's first quoted floor to its last, to two decimals. Null when
 * the window never held two quoted days, or opened at zero — there is nothing to be a
 * percentage of. Scaled through BigInt because prices are wei-scale and overflow a Number.
 */
function changePercent(points) {
  const quoted = points.filter((point) => point.floor !== null)
  if (quoted.length < 2) return null

  const first = BigInt(quoted[0].floor)
  const last = BigInt(quoted[quoted.length - 1].floor)
  if (first === 0n) return null

  return Number(((last - first) * 10000n) / first) / 100
}

/**
 * Daily floor series for a set of collections, in one query however many are asked for.
 * @param {Object} params
 * @param {Array<[number|string, string]>} params.keys `[networkId, collectionAddress]` pairs;
 * addresses must already be lowercased to match the index.
 * @param {number|string} [params.days] Window length, clamped to [2, 180].
 * @param {number} [params.now] Unix seconds to treat as "today"; injectable for tests.
 * @param {boolean} [params.withSales] Also return `sales` (one entry per day that traded) and
 * `last_sale`. Costs a second query, so only the collection page asks for it — see the file
 * header. Both fields are omitted entirely when off, leaving the rail's payload untouched.
 * @returns {Promise<Array<Object>>} One row per requested key, in the order asked for. Rows for
 * collections with no listings in the window still come back, with an empty `points`.
 */
export async function getFloorHistory({
  keys,
  days = DEFAULT_DAYS,
  now = Math.floor(Date.now() / 1000),
  withSales = false,
}) {
  if (!keys.length) return []

  const span = Math.min(Math.max(parseInt(days) || DEFAULT_DAYS, MIN_DAYS), MAX_DAYS)
  const today = dayStart(now)
  const windowStart = today - (span - 1) * DAY_SECONDS

  const buckets = []
  for (let i = 0; i < span; i++) buckets.push(windowStart + i * DAY_SECONDS)

  // Active listings always qualify (they are live right now whatever they cost); ended ones
  // only matter if they were still live somewhere inside the window
  const [rows] = await pool.execute(
    `SELECT l.network_id, l.collection, l.payment_token, l.status, l.listed_at,
            CAST(l.price AS CHAR) AS price,
            UNIX_TIMESTAMP(l.updated_at) AS indexed_at,
            t.sold_at, st.symbol, st.decimals
       FROM nft_listings l
       LEFT JOIN nft_trades t ON t.network_id = l.network_id AND t.listing_id = l.listing_id
       LEFT JOIN store_tokens st ON st.network_id = l.network_id AND st.token = l.payment_token
      WHERE (l.network_id, l.collection) IN (${keys.map(() => '(?,?)').join(',')})
        AND l.listed_at < ?
        AND (l.status = ? OR COALESCE(t.sold_at, UNIX_TIMESTAMP(l.updated_at)) >= ?)`,
    [...keys.flat(), today + DAY_SECONDS, STATUS_ACTIVE, windowStart],
  )

  // nft_trades carries its own collection and payment_token, so sales need no join back to
  // the listing they settled — a trade is a fact about the collection, not about the ask
  const salesByCollection = new Map()
  if (withSales) {
    const [saleRows] = await pool.execute(
      `SELECT t.network_id, t.collection, t.listing_id, t.token_id, t.payment_token, t.sold_at,
              CAST(t.price AS CHAR) AS price, st.symbol, st.decimals
         FROM nft_trades t
         LEFT JOIN store_tokens st ON st.network_id = t.network_id AND st.token = t.payment_token
        WHERE (t.network_id, t.collection) IN (${keys.map(() => '(?,?)').join(',')})
          AND t.sold_at >= ? AND t.sold_at < ?
        ORDER BY t.sold_at`,
      [...keys.flat(), windowStart, today + DAY_SECONDS],
    )

    for (const row of saleRows) {
      const key = `${row.network_id}-${row.collection}`
      if (!salesByCollection.has(key)) salesByCollection.set(key, [])
      salesByCollection.get(key).push({
        // listing_id is the sale's address in the app — /nfts/[networkId]/[listingId] is the
        // page the settled listing still renders on, so it is what a chart marker links to
        listing_id: Number(row.listing_id),
        token_id: row.token_id,
        payment_token: row.payment_token,
        sold_at: Number(row.sold_at),
        price: row.price,
        symbol: row.symbol,
        decimals: row.decimals,
      })
    }
  }

  const byCollection = new Map()
  for (const row of rows) {
    const key = `${row.network_id}-${row.collection}`
    const status = Number(row.status)

    if (!byCollection.has(key)) byCollection.set(key, [])
    byCollection.get(key).push({
      payment_token: row.payment_token,
      status,
      listed_at: Number(row.listed_at),
      price: row.price,
      symbol: row.symbol,
      decimals: row.decimals,
      // See the file header — sold is exact, active is open-ended, cancelled approximates
      endsAt: row.sold_at !== null ? Number(row.sold_at) : status === STATUS_ACTIVE ? null : Number(row.indexed_at),
    })
  }

  return keys.map(([networkId, collection]) => {
    const key = `${networkId}-${collection}`
    const listings = byCollection.get(key) || []
    const sales = salesByCollection.get(key) || []

    // Listings are the currency authority, because the floor is the anchor everything else is
    // read against. Sales only get to name it when nothing was listed in the window at all —
    // which still leaves "last sale" quotable on a collection whose listings have all aged out.
    const dominant = dominantToken(listings) || dominantToken(sales)

    if (!dominant) {
      return {
        network_id: Number(networkId),
        collection,
        days: span,
        points: [],
        change_pct: null,
        ...(withSales ? { sales: [], last_sale: null } : {}),
      }
    }

    const priced = listings.filter((listing) => listing.payment_token === dominant.payment_token)
    const points = buildSeries(priced, buckets)

    // Same rule the floor lives by: a sale in another token is dropped rather than plotted
    // against an axis denominated in this one. Better a missing marker than a wrong one.
    const quotedSales = sales.filter((sale) => sale.payment_token === dominant.payment_token)
    const latest = quotedSales[quotedSales.length - 1]

    return {
      network_id: Number(networkId),
      collection,
      days: span,
      payment_token: dominant.payment_token,
      // Null for native currency — store_tokens has no row for it, so the client fills both in
      // from its chain config exactly like the market rail's floor already does
      symbol: dominant.symbol,
      decimals: dominant.decimals,
      points,
      change_pct: changePercent(points),
      ...(withSales
        ? {
            sales: buildSaleSeries(quotedSales),
            // Bounded by the window like everything else here, so this going null on a short
            // range is itself the answer: nothing traded in those days
            last_sale: latest
              ? {
                  date: dayKey(latest.sold_at),
                  sold_at: latest.sold_at,
                  price: latest.price,
                  listing_id: latest.listing_id,
                  token_id: latest.token_id,
                }
              : null,
          }
        : {}),
    }
  })
}

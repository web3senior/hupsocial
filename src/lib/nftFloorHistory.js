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
 */
function dominantToken(listings) {
  const tally = new Map()

  for (const listing of listings) {
    const entry = tally.get(listing.payment_token) || { active: 0, total: 0, listing }
    if (listing.status === STATUS_ACTIVE) entry.active += 1
    entry.total += 1
    tally.set(listing.payment_token, entry)
  }

  let best = null
  for (const entry of tally.values()) {
    if (!best || entry.active > best.active || (entry.active === best.active && entry.total > best.total)) best = entry
  }
  return best?.listing || null
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
 * @returns {Promise<Array<Object>>} One row per requested key, in the order asked for. Rows for
 * collections with no listings in the window still come back, with an empty `points`.
 */
export async function getFloorHistory({ keys, days = DEFAULT_DAYS, now = Math.floor(Date.now() / 1000) }) {
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
    const listings = byCollection.get(`${networkId}-${collection}`) || []
    const dominant = dominantToken(listings)

    if (!dominant) {
      return { network_id: Number(networkId), collection, days: span, points: [], change_pct: null }
    }

    const priced = listings.filter((listing) => listing.payment_token === dominant.payment_token)
    const points = buildSeries(priced, buckets)

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
    }
  })
}

/**
 * @file api/v1/launches/route.js
 * @description Lists Hup Launch token launches from the cidex-indexed launches table. The app
 * never scans chains — the factory's LaunchCreated plus each launch pool's Uniswap Swap events
 * land here via the cidex runLaunchSync runner, which keeps last price/volume rollups current
 * and denormalizes the launch's IPFS metadata (description, image) into columns. Hidden
 * (moderated) rows are never served; hiding is UI-level only — the pool itself is permissionless.
 *
 * `scope` is the original axis (trending / new / mine) and every other caller still uses it. The
 * explorer adds `sort`, which only reorders, and `stats=1`, which turns on the launch_trades
 * rollups — ATH, traders, 24h volume, the change windows and the sparkline. Those cost a grouped
 * pass over the trades table, so they are opt-in rather than paid for by the swap page's pickers.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'
import { fetchUsdPrices, priceKeyFor } from '@/lib/prices'
import { attachQuoteAssets } from '@/lib/stockTokens'

export const runtime = 'nodejs'

// uint256 columns are DECIMAL(65,0) in MariaDB and must come back as strings — the values
// routinely exceed Number.MAX_SAFE_INTEGER, and lib/launch.js reads them straight into BigInt.
const LAUNCH_COLUMNS = `
  l.network_id,
  l.launch_id,
  l.creator AS wallet_address,
  l.token,
  l.pool_id,
  l.quote,
  l.position_token_id,
  l.name,
  l.symbol,
  l.creator_share_bps,
  CAST(l.opening_price AS CHAR) AS opening_price,
  CAST(l.price AS CHAR) AS price,
  l.metadata_cid,
  l.description,
  l.image_cid,
  l.trade_count,
  CAST(l.volume_native AS CHAR) AS volume_native,
  l.holder_count,
  l.last_trade_at,
  l.created_at,
  l.tx_hash,
  u.name AS display_name,
  u.profileImage AS profile_image`

const SORTS = ['recent', 'newest', 'oldest', 'mcap', 'vol24h']

// Market cap and 24h volume cannot be ordered in SQL: both are raw base units of whatever asset
// the launch is priced in, and the database knows neither that asset's decimals nor its dollar
// price. So those two pull a bounded candidate set, convert, and sort in memory.
const IN_MEMORY_SORTS = new Set(['mcap', 'vol24h'])
const CANDIDATE_CAP = 300

const HOUR = 3600
const DAY = 86400
// Twelve two-hour closes. Enough shape for a sparkline, few enough to stay one grouped query.
const SPARK_BUCKET = 7200

/**
 * The price of the last trade before a cutoff, as one aggregate.
 *
 * MariaDB has no "value at the max of another column" aggregate, so the timestamp is zero-padded
 * into a sortable prefix, MAX picks the latest row, and the price is cut back off the end.
 */
const priceBefore = (alias) =>
  `SUBSTRING_INDEX(MAX(CASE WHEN traded_at < ? THEN CONCAT(LPAD(traded_at, 20, '0'), ':', price) END), ':', -1) AS ${alias}`

/** Placeholders and arguments for a `(network_id, launch_id) IN (...)` row-constructor list. */
const pairFilter = (rows) => ({
  placeholders: rows.map(() => '(?,?)').join(','),
  args: rows.flatMap((row) => [row.network_id, row.launch_id]),
})

/**
 * Attaches the launch_trades rollups to a page of launches.
 *
 * Everything here is derived rather than stored, because the launches row carries lifetime totals
 * only — a 24h figure or a change window read off it would be the token's whole history wearing
 * a day's label. Mutates the rows in place; a launch with no trades keeps its zeroes.
 */
const attachTradeStats = async (rows, now) => {
  if (rows.length === 0) return

  const { placeholders, args } = pairFilter(rows)
  const cutoff1h = now - HOUR
  const cutoff6h = now - 6 * HOUR
  const cutoff24h = now - DAY

  const [stats] = await pool.execute(
    `SELECT
       network_id,
       launch_id,
       CAST(MAX(price) AS CHAR) AS ath_price,
       COUNT(DISTINCT trader) AS trader_count,
       CAST(COALESCE(SUM(CASE WHEN traded_at >= ? THEN native_amount END), 0) AS CHAR) AS volume_24h,
       COALESCE(SUM(CASE WHEN traded_at >= ? THEN 1 END), 0) AS txns_24h,
       ${priceBefore('price_1h_ago')},
       ${priceBefore('price_6h_ago')},
       ${priceBefore('price_24h_ago')}
     FROM launch_trades
     WHERE (network_id, launch_id) IN (${placeholders})
     GROUP BY network_id, launch_id`,
    [cutoff24h, cutoff24h, cutoff1h, cutoff6h, cutoff24h, ...args],
  )

  // Two-hour closes over the last day, in order, so the client draws a series rather than
  // re-deriving one from a page of raw trades
  const [series] = await pool.execute(
    `SELECT
       network_id,
       launch_id,
       SUBSTRING_INDEX(MAX(CONCAT(LPAD(traded_at, 20, '0'), ':', price)), ':', -1) AS close
     FROM launch_trades
     WHERE traded_at >= ? AND (network_id, launch_id) IN (${placeholders})
     GROUP BY network_id, launch_id, FLOOR(traded_at / ${SPARK_BUCKET})
     ORDER BY network_id, launch_id, FLOOR(traded_at / ${SPARK_BUCKET})`,
    [cutoff24h, ...args],
  )

  const statsByLaunch = new Map(stats.map((row) => [`${row.network_id}:${row.launch_id}`, row]))
  const seriesByLaunch = new Map()
  for (const point of series) {
    const key = `${point.network_id}:${point.launch_id}`
    if (!seriesByLaunch.has(key)) seriesByLaunch.set(key, [])
    seriesByLaunch.get(key).push(point.close)
  }

  for (const row of rows) {
    const key = `${row.network_id}:${row.launch_id}`
    const stat = statsByLaunch.get(key)

    row.ath_price = stat?.ath_price ?? row.price
    row.trader_count = Number(stat?.trader_count ?? 0)
    row.volume_24h = stat?.volume_24h ?? '0'
    row.txns_24h = Number(stat?.txns_24h ?? 0)

    // A launch younger than the window has no trade before it, and its opening price is exactly
    // the right baseline — that is what "since it existed" means for a token an hour old
    row.price_1h_ago = stat?.price_1h_ago ?? row.opening_price
    row.price_6h_ago = stat?.price_6h_ago ?? row.opening_price
    row.price_24h_ago = stat?.price_24h_ago ?? row.opening_price
    row.spark = seriesByLaunch.get(key) ?? []
  }
}

/** Dollar value of a raw base-unit figure, or null when the quote asset has no feed. */
const toUsd = (raw, quoteUsd, decimals) => {
  if (!quoteUsd) return null
  try {
    // Leaves BigInt before dividing: an integer division against 1e18 floors every sub-micro-dollar
    // price to zero, which would rank a whole class of launches as worthless
    return (Number(BigInt(raw ?? 0)) / 10 ** Number(decimals)) * quoteUsd
  } catch {
    return null
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)

    const scope = ['trending', 'new', 'mine'].includes(searchParams.get('scope'))
      ? searchParams.get('scope')
      : 'trending'
    const sort = SORTS.includes(searchParams.get('sort')) ? searchParams.get('sort') : null
    const wantsStats = searchParams.get('stats') === '1'
    const networkId = parseInt(searchParams.get('networkId')) || null
    const creator = (searchParams.get('creator') || '').toLowerCase() || null
    const q = (searchParams.get('q') || '').trim().slice(0, 100) || null
    const page = parseInt(searchParams.get('page')) || 1
    const limit = Math.min(parseInt(searchParams.get('limit')) || 25, 50)
    const offset = (page - 1) * limit

    const networkFilter = networkId ? 'AND l.network_id = ?' : ''
    const networkArgs = networkId ? [networkId] : []

    const searchFilter = q ? 'AND (l.name LIKE ? OR l.symbol LIKE ? OR l.description LIKE ?)' : ''
    const searchArgs = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : []

    let scopeFilter = ''
    let scopeArgs = []
    let orderBy = 'l.created_at DESC, l.launch_id DESC'

    if (scope === 'trending') {
      // Volume over the last day, falling back to recency for launches with no trades yet
      orderBy = 'l.last_trade_at > (UNIX_TIMESTAMP() - 86400) DESC, l.volume_native DESC, l.created_at DESC'
    } else if (scope === 'mine') {
      if (!creator) {
        return NextResponse.json({ success: false, error: 'creator is required for scope=mine' }, { status: 400 })
      }
      scopeFilter = 'AND l.creator = ?'
      scopeArgs = [creator]
    }

    // An explicit sort only reorders — `scope` still decides which rows are in play
    if (sort === 'recent') orderBy = 'l.last_trade_at IS NULL, l.last_trade_at DESC, l.created_at DESC'
    else if (sort === 'newest') orderBy = 'l.created_at DESC, l.launch_id DESC'
    else if (sort === 'oldest') orderBy = 'l.created_at ASC, l.launch_id ASC'
    else if (IN_MEMORY_SORTS.has(sort)) orderBy = 'l.created_at DESC, l.launch_id DESC'

    const filters = `WHERE l.hidden = 0 ${networkFilter} ${searchFilter} ${scopeFilter}`
    const filterArgs = [...networkArgs, ...searchArgs, ...scopeArgs]

    // The whole matching set, for the count beside the heading — not the page's own length
    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM launches l ${filters}`,
      filterArgs,
    )

    // A sort the database cannot express takes a bounded slice of the matching set and orders it
    // here; every other sort pages in SQL
    const inMemory = IN_MEMORY_SORTS.has(sort)
    const [rows] = await pool.execute(
      `SELECT ${LAUNCH_COLUMNS}
       FROM launches l
       LEFT JOIN users u ON u.wallet_address = l.creator
       ${filters}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
      [...filterArgs, inMemory ? CANDIDATE_CAP : limit + 1, inMemory ? 0 : offset],
    )

    const hasMore = !inMemory && rows.length > limit
    let launches = hasMore ? rows.slice(0, limit) : rows

    // Every figure below is raw base units of whatever the launch is priced in, so its ticker,
    // decimals and dollar price travel with the row — a page spanning several chains and several
    // quote assets would otherwise need a chain read each before it could render one number
    const keys = [...new Set(launches.map((row) => priceKeyFor(row.network_id, row.quote)).filter(Boolean))]
    const usd = await fetchUsdPrices(keys)
    for (const row of launches) {
      const key = priceKeyFor(row.network_id, row.quote)
      row.quote_usd = (key ? usd.get(key) : null) ?? null
    }

    await attachQuoteAssets(launches)

    const now = Math.floor(Date.now() / 1000)
    // 24h volume is one of the sortable figures, so the rollups have to land before the ordering
    if (wantsStats || sort === 'vol24h') await attachTradeStats(launches, now)

    if (inMemory) {
      const rank = (row) =>
        sort === 'mcap'
          ? (toUsd(row.price, row.quote_usd, row.quote_decimals) ?? -1)
          : (toUsd(row.volume_24h, row.quote_usd, row.quote_decimals) ?? -1)

      launches = launches
        .map((row) => ({ row, rank: rank(row) }))
        .sort((a, b) => b.rank - a.rank)
        .slice(offset, offset + limit)
        .map((entry) => entry.row)
    }

    await fulfillUniversalProfiles(launches, pool)

    return NextResponse.json({
      success: true,
      data: launches,
      nextPage: hasMore ? page + 1 : null,
      meta: {
        page,
        count: launches.length,
        total: Number(total ?? 0),
        hasMore,
        // The in-memory sorts only ever see the candidate slice, so say when the ordering could
        // not have considered everything rather than letting a caller assume it did
        truncated: inMemory && Number(total ?? 0) > CANDIDATE_CAP,
      },
    })
  } catch (error) {
    console.error('[GET_LAUNCHES_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

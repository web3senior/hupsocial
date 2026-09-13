/**
 * @file api/v1/launches/[networkId]/[id]/leaderboard/route.js
 * @description Who is actually winning on one Hup Launch token, ranked by profit.
 *
 * The holders route answers "who owns this" and drops a wallet the moment it sells out — which
 * hides exactly the traders who did best. This ranks everyone who has ever traded the token,
 * exited or not, by realised proceeds plus what their open position is worth:
 *
 *   pnl = native_out + (held * price / 1e18) - native_in
 *
 * Everything is derived from launch_trades, including `held` (tokens bought minus tokens sold),
 * rather than from the launch_holders balances the holders route uses. Two reasons: a leaderboard
 * measures trading, so a bag that arrived by airdrop or transfer is not a win and should not
 * count; and one source cannot disagree with itself, whereas a wallet missing from launch_holders
 * would otherwise read as having lost everything it bought.
 *
 * Wallets that only ever sold — gifted in, then dumped — have a real profit and no cost basis, so
 * their return percentage is null rather than an infinite gain.
 *
 * Ranking happens in SQL, not after the fact: `launches.price` is a column, so the whole ordering
 * is one exact DECIMAL expression. Sorting a fetched page in JS would rank the page, not the token.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'
import { fetchUsdPrices, priceKeyFor } from '@/lib/prices'

export const runtime = 'nodejs'

const MAX_LIMIT = 100

/**
 * Every trader on one launch, scored and ranked. Takes four binds:
 * (networkId, launchId) for the trades, then again for the launch's own last price.
 *
 * uint256 columns are DECIMAL(65,0), so no step here passes through a float — the values are
 * only cast to CHAR at the edge, for transport.
 */
const RANKED_TRADERS_SQL = `
  SELECT
    ranked.*,
    ROW_NUMBER() OVER (
      ORDER BY ranked.pnl_raw DESC, ranked.native_out DESC, ranked.trader ASC
    ) AS rank_position
  FROM (
    SELECT
      priced.*,
      priced.native_out + priced.held_value - priced.native_in AS pnl_raw
    FROM (
      SELECT
        agg.*,
        FLOOR(agg.held * l.price / 1000000000000000000) AS held_value
      FROM (
        SELECT
          t.trader,
          SUM(CASE WHEN t.side = 0 THEN t.native_amount ELSE 0 END) AS native_in,
          SUM(CASE WHEN t.side = 1 THEN t.native_amount ELSE 0 END) AS native_out,
          -- The open position: what this wallet bought here and has not sold back
          GREATEST(
            SUM(CASE WHEN t.side = 0 THEN t.token_amount ELSE 0 END) -
            SUM(CASE WHEN t.side = 1 THEN t.token_amount ELSE 0 END),
            0
          ) AS held,
          COUNT(*) AS trade_count,
          MIN(t.traded_at) AS first_traded_at,
          MAX(t.traded_at) AS last_traded_at
        FROM launch_trades t
        WHERE t.network_id = ? AND t.launch_id = ?
        GROUP BY t.trader
      ) agg
      CROSS JOIN (
        SELECT price FROM launches WHERE network_id = ? AND launch_id = ? LIMIT 1
      ) l
    ) priced
  ) ranked`

const ROW_COLUMNS = `
  r.rank_position,
  r.trader AS wallet_address,
  CAST(r.native_in AS CHAR) AS native_in,
  CAST(r.native_out AS CHAR) AS native_out,
  CAST(r.held AS CHAR) AS held,
  CAST(r.held_value AS CHAR) AS held_value,
  CAST(r.pnl_raw AS CHAR) AS pnl,
  r.trade_count,
  r.first_traded_at,
  r.last_traded_at,
  u.name AS display_name,
  u.profileImage AS profile_image`

export async function GET(request, { params }) {
  try {
    const { networkId: rawNetworkId, id: rawLaunchId } = await params
    const { searchParams } = new URL(request.url)
    const networkId = parseInt(rawNetworkId) || null
    const limit = Math.min(parseInt(searchParams.get('limit')) || 50, MAX_LIMIT)
    const rawMe = searchParams.get('me') || ''
    const me = /^0x[0-9a-fA-F]{40}$/.test(rawMe) ? rawMe.toLowerCase() : null

    if (!networkId || !/^\d+$/.test(String(rawLaunchId))) {
      return NextResponse.json(
        { success: false, error: 'networkId and a numeric launch id are required' },
        { status: 400 },
      )
    }

    const [launchRows] = await pool.execute(
      `SELECT quote, symbol, CAST(price AS CHAR) AS price
       FROM launches WHERE network_id = ? AND launch_id = ? LIMIT 1`,
      [networkId, rawLaunchId],
    )
    if (launchRows.length === 0) {
      return NextResponse.json({ success: false, error: 'Launch not found' }, { status: 404 })
    }

    const rankArgs = [networkId, rawLaunchId, networkId, rawLaunchId]

    // LIMIT cannot be a placeholder in a prepared statement, hence the clamped integer above
    const [rows] = await pool.execute(
      `SELECT ${ROW_COLUMNS}
       FROM (${RANKED_TRADERS_SQL}) r
       LEFT JOIN users u ON u.wallet_address = r.trader
       ORDER BY r.rank_position
       LIMIT ${limit}`,
      rankArgs,
    )

    const [[totals]] = await pool.execute(
      `SELECT COUNT(DISTINCT trader) AS traders FROM launch_trades WHERE network_id = ? AND launch_id = ?`,
      [networkId, rawLaunchId],
    )

    /*
     * "Where do I stand" is half of what a leaderboard is for, so a connected wallet that traded
     * but placed below the page still gets a row of its own. Only queried when it is genuinely
     * absent — a wallet inside the page already carries its rank.
     */
    let you = null
    if (me && !rows.some((row) => String(row.wallet_address).toLowerCase() === me)) {
      const [meRows] = await pool.execute(
        `SELECT ${ROW_COLUMNS}
         FROM (${RANKED_TRADERS_SQL}) r
         LEFT JOIN users u ON u.wallet_address = r.trader
         WHERE r.trader = ?
         LIMIT 1`,
        [...rankArgs, me],
      )
      you = meRows[0] ?? null
    }

    await fulfillUniversalProfiles(you ? [...rows, you] : rows, pool)

    const priceKey = priceKeyFor(networkId, launchRows[0].quote)
    const usd = priceKey ? (await fetchUsdPrices([priceKey])).get(priceKey) : null

    return NextResponse.json({
      success: true,
      data: rows,
      meta: {
        count: rows.length,
        traders: Number(totals?.traders ?? 0),
        price: launchRows[0].price,
        symbol: launchRows[0].symbol,
        quote_usd: usd ?? null,
        you,
      },
    })
  } catch (error) {
    console.error('[GET_LAUNCH_LEADERBOARD_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

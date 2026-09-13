/**
 * @file api/v1/launches/[networkId]/[id]/holders/route.js
 * @description Who holds a Hup Launch token, ranked by size.
 *
 * Balances come from launch_holders, which cidex maintains by replaying the token's own Transfer
 * events — trades alone cannot answer this, because a wallet can arrive by transfer without ever
 * swapping. Contracts that move supply without owning it (the pool, the factory, the locker, the
 * burn address) are already excluded at index time, so this route ranks people.
 *
 * Cost basis is joined from indexed trades, because the chain can tell you what someone holds but
 * never what they paid. A holder who arrived by transfer therefore has a position and no basis,
 * and their profit is reported as null rather than as a fabricated zero.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'
import { fetchUsdPrices, priceKeyFor } from '@/lib/prices'

export const runtime = 'nodejs'

const MAX_LIMIT = 100

export async function GET(request, { params }) {
  try {
    const { networkId: rawNetworkId, id: rawLaunchId } = await params
    const { searchParams } = new URL(request.url)
    const networkId = parseInt(rawNetworkId) || null
    const limit = Math.min(parseInt(searchParams.get('limit')) || 30, MAX_LIMIT)

    if (!networkId || !/^\d+$/.test(String(rawLaunchId))) {
      return NextResponse.json(
        { success: false, error: 'networkId and a numeric launch id are required' },
        { status: 400 },
      )
    }

    const [launchRows] = await pool.execute(
      `SELECT quote, CAST(price AS CHAR) AS price FROM launches WHERE network_id = ? AND launch_id = ? LIMIT 1`,
      [networkId, rawLaunchId],
    )
    if (launchRows.length === 0) {
      return NextResponse.json({ success: false, error: 'Launch not found' }, { status: 404 })
    }

    // LIMIT cannot be a placeholder in a prepared statement, hence the clamped integer above
    const [rows] = await pool.execute(
      `SELECT
         h.holder AS wallet_address,
         CAST(h.balance AS CHAR) AS balance,
         CAST(COALESCE(t.native_in, 0) AS CHAR) AS native_in,
         CAST(COALESCE(t.native_out, 0) AS CHAR) AS native_out,
         COALESCE(t.trade_count, 0) AS trade_count,
         u.name AS display_name,
         u.profileImage AS profile_image
       FROM launch_holders h
       LEFT JOIN (
         SELECT
           trader,
           SUM(CASE WHEN side = 0 THEN native_amount ELSE 0 END) AS native_in,
           SUM(CASE WHEN side = 1 THEN native_amount ELSE 0 END) AS native_out,
           COUNT(*) AS trade_count
         FROM launch_trades
         WHERE network_id = ? AND launch_id = ?
         GROUP BY trader
       ) t ON t.trader = h.holder
       LEFT JOIN users u ON u.wallet_address = h.holder
       WHERE h.network_id = ? AND h.launch_id = ? AND h.balance > 0
       ORDER BY h.balance DESC
       LIMIT ${limit}`,
      [networkId, rawLaunchId, networkId, rawLaunchId],
    )

    await fulfillUniversalProfiles(rows, pool)

    const priceKey = priceKeyFor(networkId, launchRows[0].quote)
    const usd = priceKey ? (await fetchUsdPrices([priceKey])).get(priceKey) : null

    return NextResponse.json({
      success: true,
      data: rows,
      meta: { count: rows.length, price: launchRows[0].price, quote_usd: usd ?? null },
    })
  } catch (error) {
    console.error('[GET_LAUNCH_HOLDERS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

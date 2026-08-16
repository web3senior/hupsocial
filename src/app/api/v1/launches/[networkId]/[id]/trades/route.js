/**
 * @file api/v1/launches/[networkId]/[id]/trades/route.js
 * @description Trade history for one launch, oldest-first, feeding the candles on the launch
 * page. Rows come from cidex's runLaunchSync, which writes one row per Uniswap Swap log on the
 * launch's pool; `price` is derived at index time from the Swap event's own sqrtPriceX96, so
 * charting never reads chain state.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(request, { params }) {
  try {
    const { networkId: rawNetworkId, id: rawLaunchId } = await params
    const { searchParams } = new URL(request.url)
    const networkId = parseInt(rawNetworkId) || null
    const trader = (searchParams.get('trader') || '').toLowerCase() || null
    const limit = Math.min(parseInt(searchParams.get('limit')) || 100, 500)

    if (!networkId || !/^\d+$/.test(String(rawLaunchId))) {
      return NextResponse.json(
        { success: false, error: 'networkId and a numeric launch id are required' },
        { status: 400 },
      )
    }

    const traderFilter = trader ? 'AND t.trader = ?' : ''
    const traderArgs = trader ? [trader] : []

    // Newest-first in SQL so LIMIT keeps the most recent window, then reversed for the chart —
    // ordering ascending here would truncate to a launch's oldest trades instead.
    const [rows] = await pool.execute(
      `SELECT
         t.trader, t.side,
         CAST(t.native_amount AS CHAR) AS native_amount,
         CAST(t.token_amount AS CHAR) AS token_amount,
         CAST(t.price AS CHAR) AS price,
         t.traded_at, t.block_number, t.tx_hash,
         u.name AS display_name, u.profileImage AS profile_image
       FROM launch_trades t
       LEFT JOIN users u ON u.wallet_address = t.trader
       WHERE t.network_id = ? AND t.launch_id = ? ${traderFilter}
       ORDER BY t.block_number DESC, t.log_index DESC
       LIMIT ?`,
      [networkId, rawLaunchId, ...traderArgs, limit],
    )

    return NextResponse.json({ success: true, data: rows.reverse(), meta: { count: rows.length } })
  } catch (error) {
    console.error('[GET_LAUNCH_TRADES_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

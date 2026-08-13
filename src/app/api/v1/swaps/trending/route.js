/**
 * @file api/v1/swaps/trending/route.js
 * @description Tokens most swapped through the /swap page recently, per network — one half of
 * the swap page's trending list (the other half is /api/v1/launches?scope=trending). A swap
 * counts for its non-native side; token↔token swaps count for both sides. Ranked by distinct
 * traders first so one wallet spamming swaps can't trend a token by itself.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

const NATIVE = '0x0000000000000000000000000000000000000000'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const networkId = parseInt(searchParams.get('networkId')) || null
    const days = Math.min(Math.max(parseInt(searchParams.get('days')) || 7, 1), 30)
    const limit = Math.min(parseInt(searchParams.get('limit')) || 8, 20)

    if (!networkId) {
      return NextResponse.json({ success: false, error: 'networkId is required' }, { status: 400 })
    }

    const since = Math.floor(Date.now() / 1000) - days * 86400

    // uint256 sums leave BIGINT range — CAST keeps them strings for the client's BigInt
    const [rows] = await pool.execute(
      `SELECT
         t.token,
         MAX(t.symbol) AS symbol,
         COUNT(*) AS swap_count,
         COUNT(DISTINCT t.wallet_address) AS trader_count,
         CAST(SUM(t.native_wei) AS CHAR) AS volume_native
       FROM (
         SELECT token_out AS token, token_out_symbol AS symbol, wallet_address, native_wei
           FROM swap_activity
          WHERE network_id = ? AND created_at > ? AND token_out != ?
         UNION ALL
         SELECT token_in, token_in_symbol, wallet_address, native_wei
           FROM swap_activity
          WHERE network_id = ? AND created_at > ? AND token_in != ?
       ) t
       GROUP BY t.token
       ORDER BY trader_count DESC, swap_count DESC
       LIMIT ?`,
      [networkId, since, NATIVE, networkId, since, NATIVE, limit],
    )

    return NextResponse.json({ success: true, data: rows, meta: { days, count: rows.length } })
  } catch (error) {
    console.error('[GET_TRENDING_SWAPS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

/**
 * @file api/v1/networks/[networkId]/[postId]/tips/route.js
 * @description Lists a post's tips from the cidex-indexed tips table (newest first) with
 * token metadata for amount formatting and tipper profile fields. The app never scans
 * chains — HupTipper's Tipped events land here via the cidex runTipperSync runner.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'

export const runtime = 'nodejs'

export async function GET(request, { params }) {
  try {
    const { networkId, postId } = await params
    const { searchParams } = new URL(request.url)

    const page = parseInt(searchParams.get('page')) || 1
    const limit = Math.min(parseInt(searchParams.get('limit')) || 10, 50)
    const offset = (page - 1) * limit

    // Amounts stay in base units (decimal strings) — the client formats them with the
    // token's decimals/symbol from store_tokens (cached there by the indexer, so no
    // chain reads happen here). Native tips join on the zero address row.
    const [rows] = await pool.execute(
      `SELECT
        t.tipper AS wallet_address,
        t.token,
        t.is_lsp7,
        t.amount,
        t.tx_hash,
        t.tipped_at,
        st.symbol,
        st.decimals,
        u.name AS display_name,
        u.profileImage AS profile_image
      FROM tips t
      LEFT JOIN store_tokens st ON st.network_id = t.network_id AND st.token = t.token
      LEFT JOIN users u ON u.wallet_address = t.tipper
      WHERE t.network_id = ? AND t.post_id = ?
      ORDER BY t.block_number DESC, t.log_index DESC
      LIMIT ? OFFSET ?`,
      [networkId, postId, limit + 1, offset],
    )

    const hasMore = rows.length > limit
    const tips = hasMore ? rows.slice(0, limit) : rows

    const [totals] = await pool.execute(
      `SELECT COUNT(*) AS total, COUNT(DISTINCT tipper) AS unique_tippers
       FROM tips WHERE network_id = ? AND post_id = ?`,
      [networkId, postId],
    )

    await fulfillUniversalProfiles(tips, pool)

    return NextResponse.json({
      success: true,
      data: tips,
      nextPage: hasMore ? page + 1 : null,
      meta: {
        page,
        count: tips.length,
        total: Number(totals[0]?.total ?? 0),
        uniqueTippers: Number(totals[0]?.unique_tippers ?? 0),
        hasMore,
      },
    })
  } catch (error) {
    console.error('[GET_POST_TIPS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

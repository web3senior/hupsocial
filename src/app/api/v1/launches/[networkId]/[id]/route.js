/**
 * @file api/v1/launches/[networkId]/[id]/route.js
 * @description Fetches a single indexed Hup Launch by its onchain id + network, so the launch
 * page and the in-post card show correct data regardless of which chain the viewer's wallet is
 * connected to. Optionally includes the viewer's position (`holder` param). Hidden (moderated)
 * launches are still served here — the pool is permissionless and holders must always be able
 * to reach their position — the directory is where hidden rows are suppressed.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'

export const runtime = 'nodejs'

export async function GET(request, { params }) {
  try {
    const { networkId: rawNetworkId, id: rawLaunchId } = await params
    const { searchParams } = new URL(request.url)
    const networkId = parseInt(rawNetworkId) || null
    const holder = (searchParams.get('holder') || '').toLowerCase() || null

    if (!networkId || !/^\d+$/.test(String(rawLaunchId))) {
      return NextResponse.json(
        { success: false, error: 'networkId and a numeric launch id are required' },
        { status: 400 },
      )
    }

    const [rows] = await pool.execute(
      `SELECT
         l.network_id, l.launch_id, l.creator AS wallet_address, l.token, l.pool, l.position_token_id,
         l.name, l.symbol, l.creator_share_bps,
         CAST(l.opening_price AS CHAR) AS opening_price,
         CAST(l.price AS CHAR) AS price,
         l.metadata_cid, l.description, l.image_cid, l.hidden,
         l.trade_count, CAST(l.volume_native AS CHAR) AS volume_native, l.holder_count,
         l.last_trade_at, l.created_at, l.created_block, l.tx_hash,
         u.name AS display_name, u.profileImage AS profile_image
       FROM launches l
       LEFT JOIN users u ON u.wallet_address = l.creator
       WHERE l.network_id = ? AND l.launch_id = ?
       LIMIT 1`,
      [networkId, rawLaunchId],
    )

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Launch not found' }, { status: 404 })
    }

    const launch = rows[0]
    await fulfillUniversalProfiles([launch], pool)

    // Net position from indexed trades. The wallet's live token balance is the authority and the
    // card reads it onchain; this is the cost basis the chain can't tell you, so the card can
    // show what the holder actually paid alongside what it is worth now.
    let position = null
    if (holder) {
      const [positionRows] = await pool.execute(
        `SELECT
           CAST(COALESCE(SUM(CASE WHEN side = 0 THEN token_amount ELSE -token_amount END), 0) AS CHAR) AS net_tokens,
           CAST(COALESCE(SUM(CASE WHEN side = 0 THEN native_amount ELSE 0 END), 0) AS CHAR) AS native_in,
           CAST(COALESCE(SUM(CASE WHEN side = 1 THEN native_amount ELSE 0 END), 0) AS CHAR) AS native_out,
           COUNT(*) AS trade_count
         FROM launch_trades
         WHERE network_id = ? AND launch_id = ? AND trader = ?`,
        [networkId, rawLaunchId, holder],
      )
      position = Number(positionRows[0]?.trade_count) > 0 ? positionRows[0] : null
    }

    return NextResponse.json({ success: true, data: launch, ...(position ? { position } : {}) })
  } catch (error) {
    console.error('[GET_LAUNCH_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

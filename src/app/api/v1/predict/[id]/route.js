/**
 * @file api/v1/predict/[id]/route.js
 * @description Fetches a single indexed Hup Predict market by its onchain id + network,
 * mirroring the community detail pattern so the market page (predict/[networkId]/[marketId])
 * shows correct data regardless of which chain the viewer's wallet is connected to. Optionally
 * includes the viewer's aggregated position (`bettor` param), the recent bet feed, and the
 * viewer's claim record. Hidden markets are still served here — bettors must always be able to
 * reach their claims — the directory is where hidden rows are suppressed.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'

export const runtime = 'nodejs'

export async function GET(request, { params }) {
  try {
    const { id: marketId } = await params
    const { searchParams } = new URL(request.url)
    const networkId = parseInt(searchParams.get('networkId')) || null
    const bettor = (searchParams.get('bettor') || '').toLowerCase() || null

    if (!networkId || !/^\d+$/.test(String(marketId))) {
      return NextResponse.json({ success: false, error: 'networkId and a numeric market id are required' }, { status: 400 })
    }

    const [rows] = await pool.execute(
      `SELECT
         m.network_id, m.market_id, m.creator AS wallet_address, m.token, m.is_token_lsp7,
         m.betting_deadline, m.closed_at, m.outcome_count, m.winning_outcome, m.state, m.fee_bps,
         m.hidden, CAST(m.total_pool AS CHAR) AS total_pool, m.outcome_pools, m.judges,
         m.metadata_cid, m.title, m.description, m.outcome_labels, m.image_cid, m.tx_hash,
         m.opened_at, u.name AS display_name, u.profileImage AS profile_image
       FROM markets m
       LEFT JOIN users u ON u.wallet_address = m.creator
       WHERE m.network_id = ? AND m.market_id = ?
       LIMIT 1`,
      [networkId, marketId],
    )

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Market not found' }, { status: 404 })
    }

    const market = rows[0]
    await fulfillUniversalProfiles([market], pool)

    // Recent bet feed (newest first) — the Activity tab
    const [recentBets] = await pool.execute(
      `SELECT b.bettor AS wallet_address, b.outcome, CAST(b.amount AS CHAR) AS amount, b.bet_at, b.tx_hash,
              u.name AS display_name, u.profileImage AS profile_image
       FROM market_bets b
       LEFT JOIN users u ON u.wallet_address = b.bettor
       WHERE b.network_id = ? AND b.market_id = ?
       ORDER BY b.block_number DESC, b.log_index DESC
       LIMIT 30`,
      [networkId, marketId],
    )
    await fulfillUniversalProfiles(recentBets, pool)

    const [bettorCounts] = await pool.execute(
      `SELECT outcome, COUNT(DISTINCT bettor) AS bettors
       FROM market_bets
       WHERE network_id = ? AND market_id = ?
       GROUP BY outcome`,
      [networkId, marketId],
    )

    const [[participants]] = await pool.execute(
      `SELECT COUNT(DISTINCT bettor) AS total
       FROM market_bets
       WHERE network_id = ? AND market_id = ?`,
      [networkId, marketId],
    )

    // Aggregated (bettor, outcome) stakes, largest first — feeds both the Top Holders
    // columns and the Positions tab clientside
    const [holders] = await pool.execute(
      `SELECT b.bettor AS wallet_address, b.outcome, CAST(SUM(b.amount) AS CHAR) AS amount,
              u.name AS display_name, u.profileImage AS profile_image
       FROM market_bets b
       LEFT JOIN users u ON u.wallet_address = b.bettor
       WHERE b.network_id = ? AND b.market_id = ?
       GROUP BY b.bettor, b.outcome, u.name, u.profileImage
       ORDER BY SUM(b.amount) DESC
       LIMIT 200`,
      [networkId, marketId],
    )
    await fulfillUniversalProfiles(holders, pool)

    // The viewer's aggregated position and claim record, when a wallet was supplied
    let position = null
    let claim = null
    if (bettor) {
      const [positionRows] = await pool.execute(
        `SELECT outcome, CAST(SUM(amount) AS CHAR) AS amount
         FROM market_bets
         WHERE network_id = ? AND market_id = ? AND bettor = ?
         GROUP BY outcome`,
        [networkId, marketId, bettor],
      )
      position = positionRows

      const [claimRows] = await pool.execute(
        `SELECT kind, CAST(amount AS CHAR) AS amount, tx_hash, claimed_at
         FROM market_claims
         WHERE network_id = ? AND market_id = ? AND account = ?
         LIMIT 1`,
        [networkId, marketId, bettor],
      )
      claim = claimRows[0] ?? null
    }

    return NextResponse.json({
      success: true,
      data: {
        market,
        recentBets,
        bettorCounts,
        participantCount: Number(participants?.total ?? 0),
        holders,
        position,
        claim,
      },
    })
  } catch (error) {
    console.error('[GET_PREDICT_DETAIL_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

/**
 * @file api/v1/drops/[dropId]/route.js
 * @description One drop's indexed record: the drop row, its immutable phase schedule, recent
 * mint activity, and revenue rollups (gross/fees/referrals plus a daily series) — the data the
 * creator's Manage panel charts. Live mint state still resolves from chain; this is history.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(request, { params }) {
  try {
    const { dropId } = await params
    const { searchParams } = new URL(request.url)
    const networkId = parseInt(searchParams.get('networkId'))

    if (!networkId || !/^\d+$/.test(String(dropId))) {
      return NextResponse.json({ success: false, error: 'networkId and a numeric dropId are required' }, { status: 400 })
    }

    const [dropRows] = await pool.execute(
      `SELECT d.network_id, d.drop_id, d.collection, d.creator, d.standard_id,
              CAST(d.max_supply AS CHAR) AS max_supply, d.minted, d.referral_bps,
              d.name, d.symbol, d.closed, d.closed_by_admin, d.created_at, d.tx_hash
       FROM drops d
       WHERE d.network_id = ? AND d.drop_id = ?
       LIMIT 1`,
      [networkId, dropId],
    )

    if (dropRows.length === 0) {
      return NextResponse.json({ success: true, data: null, indexed: true })
    }

    const [phases] = await pool.execute(
      `SELECT phase_index, start_time, end_time, CAST(price AS CHAR) AS price, per_wallet,
              allocation, gate, gate_asset, gate_data, CAST(gate_min AS CHAR) AS gate_min, minted
       FROM drop_phases
       WHERE network_id = ? AND drop_id = ?
       ORDER BY phase_index ASC`,
      [networkId, dropId],
    )

    const [mints] = await pool.execute(
      `SELECT m.phase_index, m.minter, m.referral, m.quantity, m.first_token_id,
              CAST(m.total_paid AS CHAR) AS total_paid, CAST(m.fee_amount AS CHAR) AS fee_amount,
              CAST(m.referral_amount AS CHAR) AS referral_amount, m.tx_hash, m.minted_at,
              u.name AS display_name, u.profileImage AS profile_image
       FROM drop_mints m
       LEFT JOIN users u ON u.wallet_address = m.minter
       WHERE m.network_id = ? AND m.drop_id = ?
       ORDER BY m.minted_at DESC, m.id DESC
       LIMIT 50`,
      [networkId, dropId],
    )

    // Rollups over ALL mints (the table above is capped): what the drop grossed, what the
    // platform and referrers took, and a daily gross series for the revenue view
    const [[totals]] = await pool.execute(
      `SELECT COUNT(*) AS mint_count, COALESCE(SUM(quantity), 0) AS items_minted,
              CAST(COALESCE(SUM(total_paid), 0) AS CHAR) AS gross,
              CAST(COALESCE(SUM(fee_amount), 0) AS CHAR) AS fees,
              CAST(COALESCE(SUM(referral_amount), 0) AS CHAR) AS referrals
       FROM drop_mints
       WHERE network_id = ? AND drop_id = ?`,
      [networkId, dropId],
    )

    const [daily] = await pool.execute(
      `SELECT DATE(minted_at) AS day, COALESCE(SUM(quantity), 0) AS items,
              CAST(COALESCE(SUM(total_paid), 0) AS CHAR) AS gross
       FROM drop_mints
       WHERE network_id = ? AND drop_id = ? AND minted_at >= (NOW() - INTERVAL 30 DAY)
       GROUP BY DATE(minted_at)
       ORDER BY day ASC`,
      [networkId, dropId],
    )

    return NextResponse.json({ success: true, data: { drop: dropRows[0], phases, mints, totals, daily } })
  } catch (error) {
    // The tables appear with the first cidex drops sync — until then report unindexed, not a 500
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      return NextResponse.json({ success: true, data: null, indexed: false })
    }
    console.error('GET /api/v1/drops/[dropId] error:', error)
    return NextResponse.json({ success: false, error: 'Failed to load drop' }, { status: 500 })
  }
}

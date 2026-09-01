/**
 * @file api/v1/drops/route.js
 * @description Lists HupDrops drops from the cidex-indexed drops table. The app never scans
 * chains — DropCreated/PhaseConfigured/Minted/DropClosed land here via the cidex runDropsSync
 * runner, which also denormalizes each collection's name/symbol at index time. Live mint state
 * (supply, phase windows, progress) still resolves from chain in the UI; these rows serve
 * discovery and creator tooling.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { appChains } from '@/config/contracts'

export const runtime = 'nodejs'

// A retired chain's indexed rows outlive its config, so only chains the app still ships are served
const LIVE_NETWORK_IDS = appChains.map((chain) => chain.id)

// uint256 columns are DECIMAL(65,0) in MariaDB and must come back as strings — price-scale
// values routinely exceed Number.MAX_SAFE_INTEGER.
const DROP_COLUMNS = `
  d.network_id,
  d.drop_id,
  d.collection,
  d.creator,
  d.standard_id,
  CAST(d.max_supply AS CHAR) AS max_supply,
  d.minted,
  d.referral_bps,
  d.name,
  d.symbol,
  d.metadata_uri,
  d.payout_destination,
  d.closed,
  d.created_at,
  d.tx_hash,
  u.name AS display_name,
  u.profileImage AS profile_image`

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)

    const networkId = parseInt(searchParams.get('networkId')) || null
    const creator = (searchParams.get('creator') || '').toLowerCase() || null
    const page = parseInt(searchParams.get('page')) || 1
    const limit = Math.min(parseInt(searchParams.get('limit')) || 25, 50)
    const offset = (page - 1) * limit

    const filters = [`d.network_id IN (${LIVE_NETWORK_IDS.map(() => '?').join(',')})`]
    const args = [...LIVE_NETWORK_IDS]
    if (networkId) {
      filters.push('d.network_id = ?')
      args.push(networkId)
    }
    if (creator) {
      filters.push('d.creator = ?')
      args.push(creator)
    }
    if (searchParams.get('status') === 'live') {
      filters.push('d.closed = 0 AND (d.max_supply = 0 OR d.minted < d.max_supply)')
    }

    const [rows] = await pool.execute(
      `SELECT ${DROP_COLUMNS}
       FROM drops d
       LEFT JOIN users u ON u.wallet_address = d.creator
       WHERE ${filters.join(' AND ')}
       ORDER BY d.created_at DESC, d.drop_id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      args,
    )

    // Phases are fetched after LIMIT — MariaDB runs select-list subqueries for every row pre-sort
    if (rows.length > 0) {
      const pairs = rows.map(() => '(?, ?)').join(', ')
      const pairArgs = rows.flatMap((row) => [row.network_id, row.drop_id])
      const [phases] = await pool.execute(
        `SELECT network_id, drop_id, phase_index, start_time, end_time, CAST(price AS CHAR) AS price,
                per_wallet, allocation, gate, paused, payment_token, is_lsp7, minted
         FROM drop_phases
         WHERE (network_id, drop_id) IN (${pairs})
         ORDER BY network_id, drop_id, phase_index ASC`,
        pairArgs,
      )
      const byDrop = new Map()
      for (const phase of phases) {
        const key = `${phase.network_id}:${phase.drop_id}`
        if (!byDrop.has(key)) byDrop.set(key, [])
        byDrop.get(key).push(phase)
      }
      for (const row of rows) {
        row.phases = byDrop.get(`${row.network_id}:${row.drop_id}`) ?? []
      }
    }

    return NextResponse.json({ success: true, data: rows })
  } catch (error) {
    // The tables appear with the first cidex drops sync — until then serve an empty list, not a 500
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      return NextResponse.json({ success: true, data: [], indexed: false })
    }
    console.error('GET /api/v1/drops error:', error)
    return NextResponse.json({ success: false, error: 'Failed to load drops' }, { status: 500 })
  }
}

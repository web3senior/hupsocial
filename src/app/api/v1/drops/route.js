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

export const runtime = 'nodejs'

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

    const filters = ['1 = 1']
    const args = []
    if (networkId) {
      filters.push('d.network_id = ?')
      args.push(networkId)
    }
    if (creator) {
      filters.push('d.creator = ?')
      args.push(creator)
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

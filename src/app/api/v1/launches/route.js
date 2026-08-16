/**
 * @file api/v1/launches/route.js
 * @description Lists Hup Launch token launches from the cidex-indexed launches table. The app
 * never scans chains — the factory's LaunchCreated plus each launch pool's Uniswap Swap events
 * land here via the cidex runLaunchSync runner, which keeps last price/volume rollups current
 * and denormalizes the launch's IPFS metadata (description, image) into columns. Hidden
 * (moderated) rows are never served; hiding is UI-level only — the pool itself is permissionless.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'

export const runtime = 'nodejs'

// uint256 columns are DECIMAL(65,0) in MariaDB and must come back as strings — the values
// routinely exceed Number.MAX_SAFE_INTEGER, and lib/launch.js reads them straight into BigInt.
const LAUNCH_COLUMNS = `
  l.network_id,
  l.launch_id,
  l.creator AS wallet_address,
  l.token,
  l.pool,
  l.position_token_id,
  l.name,
  l.symbol,
  l.creator_share_bps,
  CAST(l.opening_price AS CHAR) AS opening_price,
  CAST(l.price AS CHAR) AS price,
  l.metadata_cid,
  l.description,
  l.image_cid,
  l.trade_count,
  CAST(l.volume_native AS CHAR) AS volume_native,
  l.holder_count,
  l.last_trade_at,
  l.created_at,
  l.tx_hash,
  u.name AS display_name,
  u.profileImage AS profile_image`

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)

    const scope = ['trending', 'new', 'mine'].includes(searchParams.get('scope'))
      ? searchParams.get('scope')
      : 'trending'
    const networkId = parseInt(searchParams.get('networkId')) || null
    const creator = (searchParams.get('creator') || '').toLowerCase() || null
    const q = (searchParams.get('q') || '').trim().slice(0, 100) || null
    const page = parseInt(searchParams.get('page')) || 1
    const limit = Math.min(parseInt(searchParams.get('limit')) || 25, 50)
    const offset = (page - 1) * limit

    const networkFilter = networkId ? 'AND l.network_id = ?' : ''
    const networkArgs = networkId ? [networkId] : []

    const searchFilter = q ? 'AND (l.name LIKE ? OR l.symbol LIKE ? OR l.description LIKE ?)' : ''
    const searchArgs = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : []

    let scopeFilter = ''
    let scopeArgs = []
    let orderBy = 'l.created_at DESC, l.launch_id DESC'

    if (scope === 'trending') {
      // Volume over the last day, falling back to recency for launches with no trades yet
      orderBy = 'l.last_trade_at > (UNIX_TIMESTAMP() - 86400) DESC, l.volume_native DESC, l.created_at DESC'
    } else if (scope === 'mine') {
      if (!creator) {
        return NextResponse.json({ success: false, error: 'creator is required for scope=mine' }, { status: 400 })
      }
      scopeFilter = 'AND l.creator = ?'
      scopeArgs = [creator]
    }

    const [rows] = await pool.execute(
      `SELECT ${LAUNCH_COLUMNS}
       FROM launches l
       LEFT JOIN users u ON u.wallet_address = l.creator
       WHERE l.hidden = 0 ${networkFilter} ${searchFilter} ${scopeFilter}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
      [...networkArgs, ...searchArgs, ...scopeArgs, limit + 1, offset],
    )

    const hasMore = rows.length > limit
    const launches = hasMore ? rows.slice(0, limit) : rows

    await fulfillUniversalProfiles(launches, pool)

    return NextResponse.json({
      success: true,
      data: launches,
      nextPage: hasMore ? page + 1 : null,
      meta: { page, count: launches.length, hasMore },
    })
  } catch (error) {
    console.error('[GET_LAUNCHES_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

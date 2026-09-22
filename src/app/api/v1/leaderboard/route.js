import { NextResponse } from 'next/server'
import {
  SORTS,
  getLeaderboardSnapshot,
  getSinceDate,
  normalizeNetworkId,
  normalizePeriod,
  serializeLeader,
} from '@/lib/leaderboard'

export const runtime = 'nodejs'

// The gift mini app's admin page runs on its own origin (a static host, not hup.social), and
// builds a round's eligible list from this ranking — so it has to be readable cross-origin. Same
// treatment as the miner routes: this is public read-only data the app already shows to everyone.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const jsonResponse = (body, init = {}) => NextResponse.json(body, { ...init, headers: CORS_HEADERS })

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const walletAddressParam = searchParams.get('wallet_address')

    const page = clampNumber(parseInt(searchParams.get('page'), 10), 1, 1000, 1)
    const limit = clampNumber(parseInt(searchParams.get('limit'), 10), 1, 100, 20)
    const offset = (page - 1) * limit
    const period = normalizePeriod(searchParams.get('period'))
    const sort = SORTS[searchParams.get('sort')] ? searchParams.get('sort') : 'score'
    const networkId = normalizeNetworkId(searchParams.get('network_id'))
    const since = getSinceDate(period)

    const snapshot = await getLeaderboardSnapshot({ period, sort, networkId, since })

    /* Handle execution branch when requesting single user leaderboard state vs paginated records list */
    if (walletAddressParam) {
      const target = walletAddressParam.toLowerCase()
      /* The old SQL match ran under utf8mb4_general_ci, so keep the lookup case-insensitive */
      const leader = snapshot.rows.find((row) => String(row.wallet_address).toLowerCase() === target)

      if (!leader) {
        return jsonResponse({ error: 'Wallet address profile score record not found on leaderboard' }, { status: 404 })
      }

      return jsonResponse({
        success: true,
        data: serializeLeader(leader, leader.global_rank),
        nextPage: null,
        meta: {
          page: 1,
          count: 1,
          hasMore: false,
          period,
          sort,
          network_id: networkId,
          stats: snapshot.stats,
          networks: snapshot.networks,
        },
      })
    }

    const leaders = snapshot.rows.slice(offset, offset + limit)
    const hasMore = offset + limit < snapshot.rows.length

    return jsonResponse({
      success: true,
      data: leaders.map((row) => serializeLeader(row, row.global_rank)),
      nextPage: hasMore ? page + 1 : null,
      meta: {
        page,
        count: leaders.length,
        hasMore,
        period,
        sort,
        network_id: networkId,
        stats: snapshot.stats,
        networks: snapshot.networks,
      },
    })
  } catch (error) {
    console.error('[LEADERBOARD_ERROR]:', error.message)
    return jsonResponse(
      {
        success: false,
        error: 'Failed to fetch leaderboard query state',
        details: process.env.NODE_ENV === 'production' ? undefined : error.message,
      },
      { status: 500 },
    )
  }
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

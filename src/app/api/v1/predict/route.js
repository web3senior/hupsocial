/**
 * @file api/v1/predict/route.js
 * @description Lists Hup Predict parimutuel markets from the cidex-indexed markets table. The
 * app never scans chains — HupPredict's lifecycle events land here via the cidex
 * runPredictSync runner, which also denormalizes each market's IPFS metadata JSON (title,
 * outcome labels, image) into columns and keeps pool totals current from BetPlaced snapshots.
 * Hidden (moderated) and metadata-less rows are never served.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'

export const runtime = 'nodejs'

const MARKET_COLUMNS = `
  m.network_id,
  m.market_id,
  m.creator AS wallet_address,
  m.token,
  m.is_token_lsp7,
  m.betting_deadline,
  m.closed_at,
  m.outcome_count,
  m.winning_outcome,
  m.state,
  m.fee_bps,
  CAST(m.total_pool AS CHAR) AS total_pool,
  m.outcome_pools,
  m.judges,
  m.metadata_cid,
  m.title,
  m.description,
  m.outcome_labels,
  m.image_cid,
  m.tx_hash,
  m.opened_at,
  u.name AS display_name,
  u.profileImage AS profile_image`

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)

    const scope = ['open', 'closed', 'settled', 'mine'].includes(searchParams.get('scope'))
      ? searchParams.get('scope')
      : 'open'
    const networkId = parseInt(searchParams.get('networkId')) || null
    const participant = (searchParams.get('participant') || '').toLowerCase() || null
    const q = (searchParams.get('q') || '').trim().slice(0, 100) || null
    const page = parseInt(searchParams.get('page')) || 1
    const limit = Math.min(parseInt(searchParams.get('limit')) || 25, 50)
    const offset = (page - 1) * limit

    const networkFilter = networkId ? 'AND m.network_id = ?' : ''
    const networkArgs = networkId ? [networkId] : []

    const searchFilter = q ? 'AND (m.title LIKE ? OR m.description LIKE ?)' : ''
    const searchArgs = q ? [`%${q}%`, `%${q}%`] : []

    // State ints mirror the contract enum: 0 Open, 1 Closed, 2 Resolved, 3 Refunding.
    // "open" is still bettable (deadline in the future); "closed" awaits a judge (explicitly
    // closed, or open with the deadline behind it); "settled" is resolved or refunding.
    let scopeFilter = ''
    let scopeArgs = []
    if (scope === 'open') {
      scopeFilter = 'AND m.state = 0 AND m.betting_deadline > UNIX_TIMESTAMP()'
    } else if (scope === 'closed') {
      scopeFilter = 'AND (m.state = 1 OR (m.state = 0 AND m.betting_deadline <= UNIX_TIMESTAMP()))'
    } else if (scope === 'settled') {
      scopeFilter = 'AND m.state IN (2, 3)'
    } else if (scope === 'mine') {
      if (!participant) {
        return NextResponse.json({ success: false, error: 'participant is required for scope=mine' }, { status: 400 })
      }
      scopeFilter = `AND (m.creator = ? OR JSON_CONTAINS(m.judges, JSON_QUOTE(?))
        OR EXISTS (SELECT 1 FROM market_bets b WHERE b.network_id = m.network_id AND b.market_id = m.market_id AND b.bettor = ?))`
      scopeArgs = [participant, participant, participant]
    }

    const [rows] = await pool.execute(
      `SELECT ${MARKET_COLUMNS}
       FROM markets m
       LEFT JOIN users u ON u.wallet_address = m.creator
       WHERE m.hidden = 0 AND m.metadata_fetched = 1 ${networkFilter} ${searchFilter} ${scopeFilter}
       ORDER BY m.opened_at DESC, m.market_id DESC
       LIMIT ? OFFSET ?`,
      [...networkArgs, ...searchArgs, ...scopeArgs, limit + 1, offset],
    )

    const hasMore = rows.length > limit
    const markets = hasMore ? rows.slice(0, limit) : rows

    await fulfillUniversalProfiles(markets, pool)

    // Distinct-bettor counts for just this page, joined in JS — a select-list subquery
    // would run for every row before the sort/limit (see the posts feed query shape)
    if (markets.length > 0) {
      const tuples = markets.map(() => '(?, ?)').join(', ')
      const tupleArgs = markets.flatMap((market) => [market.network_id, market.market_id])
      const [counts] = await pool.execute(
        `SELECT network_id, market_id, COUNT(DISTINCT bettor) AS bettors
         FROM market_bets
         WHERE (network_id, market_id) IN (${tuples})
         GROUP BY network_id, market_id`,
        tupleArgs,
      )
      const countByKey = Object.fromEntries(counts.map((row) => [`${row.network_id}-${row.market_id}`, Number(row.bettors)]))
      for (const market of markets) {
        market.bettor_count = countByKey[`${market.network_id}-${market.market_id}`] ?? 0
      }
    }

    return NextResponse.json({
      success: true,
      data: markets,
      nextPage: hasMore ? page + 1 : null,
      meta: { page, count: markets.length, hasMore },
    })
  } catch (error) {
    console.error('[GET_PREDICT_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

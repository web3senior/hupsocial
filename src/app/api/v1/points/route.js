/**
 * @file api/v1/points/route.js
 * @description GET ?season=&page=&limit=&sort=&network_id=&wallet= — a points season's standings, a
 * page at a time, with the season's rules and totals. `sort` re-orders the ranked wallets
 * (STANDINGS_SORTS); `network_id` reads the season on one network (lib/points.js); `wallet` adds
 * that wallet's own standing, ranked or not, with its position in that order.
 */

import { NextResponse } from 'next/server'
import { isAddress } from 'viem'
import { POINTS_RULES, currentSeason, seasonById, standingsSort } from '@/config/points'
import { getSeasonStandings } from '@/lib/points'
import { normalizeNetworkId } from '@/lib/leaderboard'

export const runtime = 'nodejs'

const clamp = (value, min, max, fallback) => (Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback)

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const season = searchParams.get('season') ? seasonById(searchParams.get('season')) : currentSeason()
    if (!season) return NextResponse.json({ success: false, error: 'Unknown season' }, { status: 404 })

    const page = clamp(parseInt(searchParams.get('page'), 10), 1, 1000, 1)
    const limit = clamp(parseInt(searchParams.get('limit'), 10), 1, 100, 20)
    const wallet = searchParams.get('wallet')
    if (wallet && !isAddress(wallet)) return NextResponse.json({ success: false, error: 'wallet must be an address' }, { status: 400 })

    const sort = standingsSort(searchParams.get('sort'))
    const networkId = normalizeNetworkId(searchParams.get('network_id'))

    const standings = await getSeasonStandings(season, { networkId })
    // `rank` is always the airdrop's order by points; `position` is the place in the order asked
    // for, ties falling back to that rank so the list is stable page to page
    const ranked = standings.rows
      .filter((row) => row.rank !== null)
      .sort((a, b) => (b[sort.field] ?? 0) - (a[sort.field] ?? 0) || a.rank - b.rank)
      .map((row, index) => ({ ...row, position: index + 1 }))
    const offset = (page - 1) * limit
    const find = (rows) => rows.find((row) => row.wallet_address.toLowerCase() === wallet.toLowerCase())
    const mine = wallet ? (find(ranked) ?? find(standings.rows) ?? null) : undefined

    return NextResponse.json({
      success: true,
      data: ranked.slice(offset, offset + limit),
      nextPage: offset + limit < ranked.length ? page + 1 : null,
      meta: {
        season: { id: season.id, name: season.name, startsAt: season.startsAt, endsAt: season.endsAt },
        rules: POINTS_RULES,
        totals: standings.totals,
        computedAt: standings.computedAt,
        sort: sort.value,
        network_id: networkId,
        ...(wallet ? { mine } : {}),
      },
    })
  } catch (error) {
    console.error('[POINTS_ERROR]:', error.message)
    return NextResponse.json(
      { success: false, error: 'Failed to load points', details: process.env.NODE_ENV === 'production' ? undefined : error.message },
      { status: 500 },
    )
  }
}

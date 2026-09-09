/**
 * @file api/v1/users/[address]/portfolio/route.js
 * @description What a wallet holds, as the profile card shows it: one native balance, a dollar
 * total across every supported chain, its 24h move, and a position count.
 *
 * Public data — the same holdings the profile's Assets tab lists to any visitor — so it needs no
 * viewer check and can be cached by the CDN. That cache is the point: hovering avatars in a feed
 * would otherwise re-read nine chains per author, per viewer.
 *
 * ?network= headlines that chain's native coin, so the figure beside a LUKSO post reads in LYX.
 */

import { NextResponse } from 'next/server'
import { fetchPortfolioSummary, isPortfolioAddress } from '@/lib/portfolio'

export const runtime = 'nodejs'

// Balances are stale the moment they are read; what matters is that the card says so, which the
// payload's own updatedAt does. Same shape the other cosmetic read routes use.
const CACHE_CONTROL = 'public, max-age=30, s-maxage=120, stale-while-revalidate=600'

export async function GET(request, { params }) {
  try {
    const { address } = await params

    if (!isPortfolioAddress(address)) {
      return NextResponse.json({ success: false, error: 'Invalid wallet address' }, { status: 400 })
    }

    const network = new URL(request.url).searchParams.get('network')
    const summary = await fetchPortfolioSummary(address, network)

    return NextResponse.json({ success: true, data: summary }, { headers: { 'Cache-Control': CACHE_CONTROL } })
  } catch (error) {
    console.error('[USER_PORTFOLIO_ERROR]:', error.message)
    // Cosmetic surface — an empty payload hides the strip, it never breaks the card around it
    return NextResponse.json({ success: true, data: null })
  }
}

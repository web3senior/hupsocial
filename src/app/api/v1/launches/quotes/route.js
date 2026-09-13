/**
 * @file api/v1/launches/quotes/route.js
 * @description What a creator can pair a launch against on one chain: the chain's native coin,
 * the curated stablecoins, and — where the chain has one — every tokenized equity in the issuer's
 * live registry. Hundreds of names, so they are served rather than bundled.
 *
 * This route says what EXISTS, never what is allowed. The factory's `quoteOpeningValue` is the
 * allowlist and the client reads it per asset, because an asset no admin has priced would open a
 * pool at a nonsense valuation.
 */
import { NextResponse } from 'next/server'
import { appChains } from '@/config/contracts'
import { quoteCandidates, NATIVE_QUOTE } from '@/lib/launchQuote'
import { getStockTokens } from '@/lib/stockTokens'

export const runtime = 'nodejs'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const networkId = parseInt(searchParams.get('networkId'), 10) || null
    if (!networkId) {
      return NextResponse.json({ success: false, error: 'networkId is required' }, { status: 400 })
    }

    const chain = appChains.find((entry) => entry.id === networkId)
    if (!chain) {
      return NextResponse.json({ success: false, error: 'Unknown network' }, { status: 404 })
    }

    const native = {
      address: NATIVE_QUOTE,
      symbol: chain.nativeCurrency?.symbol ?? 'ETH',
      name: chain.nativeCurrency?.name ?? 'Ether',
      decimals: chain.nativeCurrency?.decimals ?? 18,
      logo: null,
      kind: 'native',
    }

    const stables = quoteCandidates(networkId).map((row) => ({
      address: row.address,
      symbol: row.symbol,
      name: row.symbol,
      decimals: row.decimals,
      logo: null,
      kind: 'stable',
    }))

    const stocks = [...(await getStockTokens(networkId)).values()].sort((a, b) =>
      a.symbol.localeCompare(b.symbol),
    )

    return NextResponse.json({
      success: true,
      data: [native, ...stables, ...stocks],
      meta: { native: 1, stables: stables.length, stocks: stocks.length },
    })
  } catch (error) {
    console.error('[GET_LAUNCH_QUOTES_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

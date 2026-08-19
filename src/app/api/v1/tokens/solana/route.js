/**
 * @file api/v1/tokens/solana/route.js
 * @description Market data for the curated Solana cashtags, for the ticker hover card. Public
 * keyless upstreams via lib/solanaPrices (process-wide cache, so the browser never talks to
 * Jupiter or DexScreener directly, and a feed full of the same cashtag costs one request).
 *
 * Takes symbols, never mints. The allowlist in config/solanaTokens resolves the mint
 * server-side, so no caller — however crafted — can make a card render an arbitrary token.
 * On Solana that matters: symbols are not unique, and the popular ones all have spoofs.
 */

import { NextResponse } from 'next/server'
import { fetchSolanaMarket } from '@/lib/solanaPrices'

export const runtime = 'nodejs'

// The in-process cache in lib/solanaPrices only helps a long-lived process. On Vercel each
// instance holds its own copy and they recycle constantly, so a busy feed means many cold
// instances all asking upstream at once — which is what got these requests rate-limited into
// empty answers during testing. The edge cache is what actually absorbs that, shared across
// every instance. Same shape the NFT collection routes use.
const CACHE_CONTROL = 'public, max-age=30, s-maxage=60, stale-while-revalidate=300'

// A post can only carry so many distinct cashtags before the request is not a real one
const MAX_SYMBOLS = 25

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const symbols = (searchParams.get('symbols') || '')
      .split(',')
      .map((symbol) => symbol.trim())
      .filter(Boolean)
      .slice(0, MAX_SYMBOLS)

    if (symbols.length === 0) {
      return NextResponse.json({ success: false, error: 'symbols is required' }, { status: 400 })
    }

    return NextResponse.json(
      { success: true, data: await fetchSolanaMarket(symbols) },
      { headers: { 'Cache-Control': CACHE_CONTROL } },
    )
  } catch (error) {
    // Cosmetic endpoint — an empty payload degrades to identity-only, never a broken card
    return NextResponse.json({ success: true, data: {} })
  }
}

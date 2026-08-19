/**
 * @file api/v1/tokens/cashtags/route.js
 * @description Everything a cashtag card draws — price, 24h move, branding and a price series —
 * for a set of symbols at one range.
 *
 * Takes symbols, never addresses. config/cashtags resolves the token server-side, so no caller
 * can make a card quote an arbitrary contract. That matters more than it sounds: symbols are
 * not unique across chains, and every popular one has spoofs sharing its ticker.
 *
 * Nothing new is fetched that the app did not already fetch somewhere — Solana rows come from
 * the Jupiter/DexScreener merge behind lib/solanaPrices, EVM rows from the DefiLlama and
 * GeckoTerminal helpers the profile Assets tab uses, and the series from lib/priceHistory.
 */

import { NextResponse } from 'next/server'
import { CASHTAGS, SLUG_CHAIN_IDS, cashtagFor, splitKey } from '@/config/cashtags'
import { fetchPriceHistory, DEFAULT_RANGE, RANGES } from '@/lib/priceHistory'
import { fetchUsdPrices, fetchUsdChange24h } from '@/lib/prices'
import { fetchTokenLogos, logoKeyFor } from '@/lib/tokenLogos'
import { fetchSolanaMarket } from '@/lib/solanaPrices'

export const runtime = 'nodejs'

// A post carrying more distinct cashtags than this is not a post about tokens
const MAX_SYMBOLS = 8

// The in-process caches in those libs only help a long-lived process; on Vercel each instance
// keeps its own and they recycle constantly. The edge cache is what actually absorbs a feed.
const CACHE_CONTROL = 'public, max-age=30, s-maxage=60, stale-while-revalidate=300'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const range = RANGES[searchParams.get('range')] ? searchParams.get('range') : DEFAULT_RANGE

    const symbols = [
      ...new Set(
        (searchParams.get('symbols') || '')
          .split(',')
          .map((symbol) => symbol.trim().toUpperCase())
          .filter((symbol) => CASHTAGS[symbol]),
      ),
    ].slice(0, MAX_SYMBOLS)

    if (symbols.length === 0) return NextResponse.json({ success: true, data: {} })

    const solanaSymbols = symbols.filter((symbol) => splitKey(cashtagFor(symbol).key).chain === 'solana')
    const otherSymbols = symbols.filter((symbol) => !solanaSymbols.includes(symbol))
    const otherKeys = otherSymbols.map((symbol) => cashtagFor(symbol).key)

    // Logos for the EVM tokens that have a contract — natives take the chain's own mark, which
    // the client already owns, and Solana branding rides along with its quote
    const logoTargets = otherSymbols
      .map((symbol) => splitKey(cashtagFor(symbol).key))
      .filter(({ chain }) => SLUG_CHAIN_IDS[chain])
      .map(({ chain, address }) => ({ chainId: SLUG_CHAIN_IDS[chain], address }))

    const [history, prices, changes, logos, solana] = await Promise.all([
      fetchPriceHistory(symbols, range),
      otherKeys.length ? fetchUsdPrices(otherKeys) : new Map(),
      otherKeys.length ? fetchUsdChange24h(otherKeys) : new Map(),
      logoTargets.length ? fetchTokenLogos(logoTargets) : new Map(),
      solanaSymbols.length ? fetchSolanaMarket(solanaSymbols) : {},
    ])

    const data = {}
    for (const symbol of symbols) {
      const entry = cashtagFor(symbol)
      const { chain, address } = splitKey(entry.key)
      const isNative = chain === 'coingecko'
      const solanaRow = solana[symbol]

      const price = solanaRow ? solanaRow.usd : (prices.get(entry.key) ?? null)
      // A card with no price has nothing to say, however good its chart is
      if (price === null || price === undefined) continue

      data[symbol] = {
        symbol,
        name: entry.name,
        price,
        change24h: solanaRow ? solanaRow.change24h : (changes.get(entry.key) ?? null),
        logo: solanaRow
          ? solanaRow.logo
          : (SLUG_CHAIN_IDS[chain] ? (logos.get(logoKeyFor(SLUG_CHAIN_IDS[chain], address)) ?? null) : null),
        // Natives are their own chain, so they take no badge — see config/chainBadges
        chainSlug: isNative ? null : chain,
        chainId: SLUG_CHAIN_IDS[chain] ?? null,
        address: isNative ? null : address,
        holders: solanaRow?.holders ?? null,
        mcap: solanaRow?.mcap ?? null,
        history: history[symbol] ?? null,
      }
    }

    return NextResponse.json({ success: true, data, range }, { headers: { 'Cache-Control': CACHE_CONTROL } })
  } catch (error) {
    // Cosmetic surface — an empty payload drops the cards, it never breaks the post
    return NextResponse.json({ success: true, data: {} })
  }
}

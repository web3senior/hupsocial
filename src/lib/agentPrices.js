/**
 * @file lib/agentPrices.js
 * @description Live USD prices for a hosted agent's read_prices tool. Server-only.
 *
 * Takes symbols, never addresses: config/cashtags resolves each one, so the agent quotes the
 * same verified token a cashtag card does and a spoofed ticker never reaches an upstream. The
 * data is what the cashtag cards already fetch (DefiLlama, and Jupiter/DexScreener for Solana
 * rows), with the same five-minute caches; nothing new is called.
 */

import { CASHTAGS, cashtagFor, splitKey } from '@/config/cashtags'
import { fetchUsdChange24h, fetchUsdPrices } from '@/lib/prices'
import { fetchSolanaMarket } from '@/lib/solanaPrices'

export const PRICE_SYMBOLS_MAX = 8

/**
 * Price and 24h move for each supported symbol; the rest come back as unsupported or unpriced.
 * @param {string[]} symbols
 * @returns {Promise<{prices: {symbol: string, name: string, usd: number, change24h: number|null}[], unsupported: string[], unpriced: string[]}>}
 */
export const readPrices = async (symbols) => {
  const asked = [...new Set((Array.isArray(symbols) ? symbols : []).map((symbol) => String(symbol ?? '').trim().replace(/^\$/, '').toUpperCase()).filter(Boolean))].slice(0, PRICE_SYMBOLS_MAX)
  const supported = asked.filter((symbol) => CASHTAGS[symbol])
  const unsupported = asked.filter((symbol) => !CASHTAGS[symbol])

  const solanaSymbols = supported.filter((symbol) => splitKey(cashtagFor(symbol).key).chain === 'solana')
  const otherKeys = supported.filter((symbol) => !solanaSymbols.includes(symbol)).map((symbol) => cashtagFor(symbol).key)

  const [usd, changes, solana] = await Promise.all([
    otherKeys.length ? fetchUsdPrices(otherKeys) : new Map(),
    otherKeys.length ? fetchUsdChange24h(otherKeys) : new Map(),
    solanaSymbols.length ? fetchSolanaMarket(solanaSymbols) : {},
  ])

  const prices = []
  const unpriced = []
  for (const symbol of supported) {
    const entry = cashtagFor(symbol)
    const solanaRow = solana[symbol]
    const price = solanaRow ? solanaRow.usd : (usd.get(entry.key) ?? null)
    if (typeof price !== 'number') {
      unpriced.push(symbol)
      continue
    }
    const change = solanaRow ? solanaRow.change24h : changes.get(entry.key)
    prices.push({ symbol, name: entry.name, usd: price, change24h: typeof change === 'number' ? Math.round(change * 100) / 100 : null })
  }

  return { prices, unsupported, unpriced }
}

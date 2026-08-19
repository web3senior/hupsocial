'use client'

/**
 * @file hooks/useTicker.jsx
 * @description Resolves one cashtag to a live quote for the hover card.
 *
 * Two back ends behind one normalized shape: allowlisted Solana mints read from Hup's own
 * /api/v1/tokens/solana (Jupiter + DexScreener, cached server-side), everything else from
 * DIA's public asset quotation.
 *
 * There is deliberately no symbol-search fallback. DIA's /v1/search resolves a bare ticker to
 * whatever it matches first, and on Solana in particular a symbol is not a unique key — the
 * popular ones each have several same-symbol, same-name spoofs. A cashtag Hup cannot resolve
 * from an explicit address or the curated allowlist now renders nothing at all, which is the
 * only safe answer when the alternative is quoting the wrong token.
 */

import useSWR from 'swr'
import { SOLANA_TOKENS } from '@/config/solanaTokens'

const REFRESH_INTERVAL_MS = 30_000
const DEDUPING_INTERVAL_MS = 5_000

const fetcher = (url) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error('Fetch failed')
    return res.json()
  })

const ZERO = '0x0000000000000000000000000000000000000000'

/** The one shape Ticker renders, whichever upstream answered. */
const quote = ({ symbol, name, price, change24h, mcap, holders, logo, chain, chainSlug }) => ({
  symbol,
  name: name ?? null,
  price: typeof price === 'number' && Number.isFinite(price) ? price : null,
  change24h: typeof change24h === 'number' && Number.isFinite(change24h) ? change24h : null,
  mcap: typeof mcap === 'number' && Number.isFinite(mcap) ? mcap : null,
  holders: typeof holders === 'number' && Number.isFinite(holders) ? holders : null,
  logo: logo ?? null,
  chain,
  // Null for native coins: their artwork already says which chain they are, so a badge on top
  // would just be the same mark twice
  chainSlug: chainSlug ?? null,
})

/**
 * @param {string} blockchain DIA chain name, ignored for Solana allowlist entries
 * @param {string|null} address explicit token address; no address means no lookup
 * @param {string} symbol the cashtag as written
 */
export function useTicker(blockchain, address, symbol) {
  const key = String(symbol || '').toUpperCase()
  const solanaToken = SOLANA_TOKENS[key] ?? null

  const {
    data: solanaData,
    error: solanaError,
    isLoading: solanaLoading,
  } = useSWR(solanaToken ? `/api/v1/tokens/solana?symbols=${key}` : null, fetcher, {
    refreshInterval: REFRESH_INTERVAL_MS,
    dedupingInterval: DEDUPING_INTERVAL_MS,
  })

  // Only an explicit address reaches DIA — see the note on symbol search above
  const diaKey =
    !solanaToken && blockchain && address
      ? `https://api.diadata.org/v1/assetQuotation/${blockchain}/${address}`
      : null

  const { data: diaData, error: diaError, isLoading: diaLoading } = useSWR(diaKey, fetcher, {
    refreshInterval: REFRESH_INTERVAL_MS,
    dedupingInterval: DEDUPING_INTERVAL_MS,
  })

  if (solanaToken) {
    const entry = solanaData?.data?.[key]
    return {
      tickerData: entry
        ? quote({
            symbol: key,
            name: entry.name,
            price: entry.usd,
            change24h: entry.change24h,
            mcap: entry.mcap,
            holders: entry.holders,
            logo: entry.logo,
            chain: 'Solana',
            chainSlug: solanaToken.native ? null : 'solana',
          })
        : null,
      isLoading: solanaLoading,
      // A resolved-but-empty payload means neither upstream could price it — not an error,
      // but nothing to draw either
      isError: Boolean(solanaError) || (!solanaLoading && !entry),
    }
  }

  if (!diaKey) return { tickerData: null, isLoading: false, isError: true }

  const price = diaData?.Price
  const yesterday = diaData?.PriceYesterday

  return {
    tickerData: diaData
      ? quote({
          symbol: diaData.Symbol || key,
          name: diaData.Name,
          price,
          change24h: yesterday ? ((price - yesterday) / yesterday) * 100 : null,
          chain: blockchain,
          // DIA's chain names lowercase into the slugs chainBadges keys on for the chains that
          // matter here; a zero address marks a native coin, which takes no badge
          chainSlug: address && address !== ZERO ? String(blockchain).toLowerCase() : null,
        })
      : null,
    isLoading: diaLoading,
    isError: Boolean(diaError) || (!diaLoading && !diaData?.Price),
  }
}

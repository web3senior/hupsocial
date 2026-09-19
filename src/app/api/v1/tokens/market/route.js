/**
 * @file api/v1/tokens/market/route.js
 * @description Cosmetic market data for a set of held tokens — USD price, 24h movement and a
 * logo — for the profile Assets tab. Both upstreams are public, keyless and best-effort
 * (DefiLlama for price via lib/prices, GeckoTerminal for branding via lib/tokenLogos), so a
 * miss on either just means the row renders without that piece rather than failing.
 *
 * Server-side because those libs hold a process-wide cache and because the browser has no
 * business making one request per chain per render.
 */

import { NextResponse } from 'next/server'
import { fetchUsdChange24h, fetchUsdPrices, priceKeyFor } from '@/lib/prices'
import { cachedTokenPrices, fetchTokenChange24h, fetchTokenLogos, logoKeyFor } from '@/lib/tokenLogos'

export const runtime = 'nodejs'

const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000'
const MAX_TOKENS = 100

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null)
    const input = Array.isArray(body?.tokens) ? body.tokens.slice(0, MAX_TOKENS) : []

    const tokens = []
    for (const token of input) {
      const chainId = Number(token?.chainId)
      if (!Number.isFinite(chainId)) continue
      const raw = typeof token?.address === 'string' ? token.address : null
      const address = raw && /^0x[a-fA-F0-9]{40}$/.test(raw) ? raw.toLowerCase() : null
      tokens.push({ chainId, address })
    }

    if (tokens.length === 0) return NextResponse.json({ success: true, data: {} })

    // One DefiLlama key per row; unpriceable chains (testnets) resolve to null and drop out
    const priceKeys = tokens.map((token) => priceKeyFor(token.chainId, token.address ?? NATIVE_TOKEN))

    const [prices, changes, logos] = await Promise.all([
      fetchUsdPrices(priceKeys),
      fetchUsdChange24h(priceKeys),
      fetchTokenLogos(tokens.filter((token) => token.address)),
    ])

    // DefiLlama has no slug for every chain the app trades on — Arc and Robinhood are absent, so
    // their tokens come back with no price and no movement at all. GeckoTerminal indexes both:
    // the price rode along in the listing response the logos came from, and the movement is a
    // second lookup made only for the few rows still missing one, since it is per-pool there.
    const gecko = cachedTokenPrices(tokens.filter((token) => token.address))
    const needChange = tokens.filter(
      (token, index) => token.address && changes.get(priceKeys[index]) === undefined && gecko.has(logoKeyFor(token.chainId, token.address)),
    )
    const geckoChanges = await fetchTokenChange24h(needChange)

    const data = {}
    tokens.forEach((token, index) => {
      const priceKey = priceKeys[index]
      const geckoKey = token.address ? logoKeyFor(token.chainId, token.address) : null
      const usd = (priceKey ? prices.get(priceKey) : undefined) ?? (geckoKey ? gecko.get(geckoKey) : undefined)
      const change24h = (priceKey ? changes.get(priceKey) : undefined) ?? (geckoKey ? geckoChanges.get(geckoKey) : undefined)
      const logo = token.address ? logos.get(logoKeyFor(token.chainId, token.address)) : undefined
      if (usd === undefined && change24h === undefined && logo === undefined) return

      data[`${token.chainId}:${token.address ?? 'native'}`] = {
        usd: usd ?? null,
        change24h: change24h ?? null,
        logo: logo ?? null,
      }
    })

    return NextResponse.json({ success: true, data })
  } catch (error) {
    // Cosmetic endpoint — an empty payload degrades to amounts-without-USD, never a broken tab
    return NextResponse.json({ success: true, data: {} })
  }
}

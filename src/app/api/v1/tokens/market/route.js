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
import { fetchTokenLogos, logoKeyFor } from '@/lib/tokenLogos'

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

    const data = {}
    tokens.forEach((token, index) => {
      const priceKey = priceKeys[index]
      const usd = priceKey ? prices.get(priceKey) : undefined
      const change24h = priceKey ? changes.get(priceKey) : undefined
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

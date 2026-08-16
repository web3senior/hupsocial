/**
 * @file api/v1/tokens/info/route.js
 * @description Profile for one token — name, branding and GeckoTerminal market numbers — for
 * the swap page's token info card. Public keyless upstream via lib/tokenInfo (process-wide
 * cache, so the browser never talks to GeckoTerminal directly). A token with no listing
 * resolves to data:null rather than an error, and the card renders identity-only.
 */
import { NextResponse } from 'next/server'
import { fetchTokenInfo } from '@/lib/tokenInfo'

export const runtime = 'nodejs'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const networkId = parseInt(searchParams.get('networkId')) || null
    const raw = searchParams.get('address')
    const address = raw && /^0x[a-fA-F0-9]{40}$/.test(raw) ? raw.toLowerCase() : null

    if (!networkId || !address) {
      return NextResponse.json({ success: false, error: 'networkId and address are required' }, { status: 400 })
    }

    return NextResponse.json({ success: true, data: await fetchTokenInfo(networkId, address) })
  } catch (error) {
    // Cosmetic endpoint — an empty payload degrades to identity-only, never a broken card
    return NextResponse.json({ success: true, data: null })
  }
}

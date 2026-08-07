/**
 * @file api/v1/nfts/collections/history/route.js
 * @description Daily floor series for a set of collections in one round trip, so the NFT
 * Market rail can draw a sparkline per card without a request per card. The sibling
 * collections/[networkId]/[address]/history serves one collection over a longer window.
 *
 * Keeps its own route rather than widening collections/route.js: the rail paints its cards
 * from that response immediately and fills the trend in behind it, so a rollup that had to
 * rebuild 30 days of history first would only make the cards later.
 */

import { NextResponse } from 'next/server'
import { getFloorHistory, DEFAULT_DAYS } from '@/lib/nftFloorHistory'

export const runtime = 'nodejs'

// Matches the collections rollup's own cap — the rail can never ask for more cards than that
const MAX_COLLECTIONS = 24

// A day-bucketed series only moves when a listing appears or ends; a minute of client
// freshness is plenty and the edge absorbs the repeat traffic.
const CACHE_CONTROL = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600'

/**
 * `networkId:0xaddress` pairs, comma separated — the shape the rail already holds its rows in.
 * Malformed pairs are skipped rather than failing the batch: one bad entry shouldn't cost the
 * other eleven cards their sparkline.
 */
function parseKeys(raw) {
  if (!raw) return []

  const keys = []
  const seen = new Set()

  for (const part of raw.split(',')) {
    const [networkId, address] = part.split(':')
    if (!/^\d+$/.test(String(networkId || '')) || !/^0x[0-9a-fA-F]{40}$/.test(String(address || ''))) continue

    const collection = address.toLowerCase()
    const key = `${networkId}-${collection}`
    if (seen.has(key)) continue

    seen.add(key)
    keys.push([Number(networkId), collection])
    if (keys.length >= MAX_COLLECTIONS) break
  }

  return keys
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const keys = parseKeys(searchParams.get('collections'))

    if (!keys.length) {
      return NextResponse.json(
        { success: false, error: 'A `collections` list of networkId:address pairs is required' },
        { status: 400 },
      )
    }

    const data = await getFloorHistory({ keys, days: searchParams.get('days') || DEFAULT_DAYS })

    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': CACHE_CONTROL } })
  } catch (error) {
    console.error('[GET_NFT_COLLECTIONS_HISTORY_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

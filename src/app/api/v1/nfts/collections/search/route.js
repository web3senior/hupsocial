/**
 * @file api/v1/nfts/collections/search/route.js
 * @description Name-and-symbol search over the collections this app has already read, so the
 * metadata manager can suggest a contract instead of demanding one be pasted.
 *
 * Reads `nft_collection_cache`, which cidex and the market fill as collections are encountered.
 * That makes this a convenience, never an authority: a collection missing from the cache is not
 * a collection that cannot be managed, which is why the caller always keeps the paste-an-address
 * path open beside it.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { appChains } from '@/config/contracts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Retired chains keep their rows; the app should not offer what it can no longer reach.
const LIVE_NETWORK_IDS = appChains.map((chain) => chain.id)

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const q = (searchParams.get('q') || '').trim()
    const networkId = parseInt(searchParams.get('networkId')) || null
    const limit = Math.min(parseInt(searchParams.get('limit')) || 8, 20)

    const filters = [`network_id IN (${LIVE_NETWORK_IDS.map(() => '?').join(',')})`]
    const args = [...LIVE_NETWORK_IDS]

    if (networkId) {
      filters.push('network_id = ?')
      args.push(networkId)
    }

    if (q) {
      // An address pasted into the search box should find its own row rather than being treated
      // as a name nobody has.
      if (/^0x[0-9a-fA-F]{40}$/.test(q)) {
        filters.push('collection = ?')
        args.push(q.toLowerCase())
      } else {
        filters.push('(name LIKE ? OR symbol LIKE ?)')
        args.push(`%${q}%`, `%${q}%`)
      }
    }

    const [rows] = await pool.query(
      `SELECT network_id, collection, name, symbol, icon_uri, is_lsp8, total_supply
         FROM nft_collection_cache
        WHERE ${filters.join(' AND ')}
        ORDER BY (name IS NULL OR name = ''), name ASC
        LIMIT ?`,
      [...args, limit],
    )

    return NextResponse.json({ data: rows })
  } catch (error) {
    console.error('GET /api/v1/nfts/collections/search error:', error)
    return NextResponse.json({ error: 'Failed to search collections' }, { status: 500 })
  }
}

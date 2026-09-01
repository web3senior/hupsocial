/**
 * @file api/v1/nfts/collections/[networkId]/[address]/thumbnails/route.js
 * @description Name and artwork for a specific set of token ids, in one request.
 *
 * The token picker needs a page of thumbnails at a time. Resolving them from chain would mean one
 * metadata read and one gateway fetch per token — sixty round trips to draw one screen — so this
 * serves whatever the indexer has already cached instead. Tokens missing from the cache simply
 * come back absent, and the caller falls back to showing the number, which is why this can be a
 * best-effort read rather than something the picker depends on.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

const MAX_IDS = 120

export async function GET(request, { params }) {
  try {
    const { networkId, address } = await params
    const chainId = parseInt(networkId)
    const collection = String(address || '').toLowerCase()

    if (!chainId || !/^0x[0-9a-f]{40}$/.test(collection)) {
      return NextResponse.json({ error: 'Bad collection' }, { status: 400 })
    }

    const ids = (new URL(request.url).searchParams.get('ids') || '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => /^\d+$/.test(value))
      .slice(0, MAX_IDS)

    if (!ids.length) return NextResponse.json({ data: [] })

    /*
     * The cache stores an LSP8 id as its full bytes32 — "0x00…07", not "7" — because that is what
     * the contract emits and what a non-numeric id would need. ERC721 rows carry the decimal form.
     * The caller thinks in numbers either way, so match both and hand back the number it asked
     * with; querying one form alone silently returns nothing for half the collections.
     */
    const asBytes32 = (id) => `0x${BigInt(id).toString(16).padStart(64, '0')}`
    const wanted = new Map()
    const keys = []
    for (const id of ids) {
      for (const key of [id, asBytes32(id)]) {
        wanted.set(key.toLowerCase(), id)
        keys.push(key)
      }
    }

    const [rows] = await pool.query(
      `SELECT token_id, name, image_uri
         FROM nft_metadata_cache
        WHERE network_id = ? AND collection = ? AND token_id IN (${keys.map(() => '?').join(',')})`,
      [chainId, collection, ...keys],
    )

    const data = rows.map((row) => ({
      token_id: wanted.get(String(row.token_id).toLowerCase()) ?? row.token_id,
      name: row.name,
      image_uri: row.image_uri,
    }))

    return NextResponse.json({ data })
  } catch (error) {
    console.error('GET thumbnails error:', error)
    return NextResponse.json({ error: 'Failed to read thumbnails' }, { status: 500 })
  }
}

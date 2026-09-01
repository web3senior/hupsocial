/**
 * @file api/v1/nfts/audits/route.js
 * @description Audited collections as a list — the /nfts/audit tool's board of what has been
 * scored lately, best and worst. Reads nft_collection_audits joined to the collection cache
 * for an icon; cidex owns every number here.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CACHE_CONTROL = 'public, max-age=60, s-maxage=120, stale-while-revalidate=300'
const MAX_LIMIT = 50

const ORDER_BY = {
  recent: 'a.audited_at DESC',
  top: 'a.score DESC, a.audited_at DESC',
  bottom: 'a.score ASC, a.audited_at DESC',
}

const parseJson = (raw, fallback) => {
  if (!raw) return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const networkParam = searchParams.get('networkId')
    const networkId = networkParam && /^\d+$/.test(networkParam) ? Number(networkParam) : null
    const sort = ORDER_BY[searchParams.get('sort')] ? searchParams.get('sort') : 'recent'
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 20, 1), MAX_LIMIT)

    const conditions = ['a.score IS NOT NULL']
    const params = []
    if (networkId) {
      conditions.push('a.network_id = ?')
      params.push(networkId)
    }

    // LIMIT is inlined: it is clamped above, and a placeholder there is a prepared-statement
    // footgun in MariaDB
    const [rows] = await pool.execute(
      `SELECT a.network_id, a.collection, a.kind, a.name, a.score, a.grade, a.badges, a.audited_at,
              cc.icon_uri, cc.name AS cached_name
         FROM nft_collection_audits a
         LEFT JOIN nft_collection_cache cc ON cc.network_id = a.network_id AND cc.collection = a.collection
        WHERE ${conditions.join(' AND ')}
        ORDER BY ${ORDER_BY[sort]}
        LIMIT ${limit}`,
      params,
    )

    const data = rows.map((row) => ({
      networkId: Number(row.network_id),
      collection: row.collection,
      kind: row.kind || null,
      name: row.name || row.cached_name || null,
      icon: row.icon_uri || null,
      score: Number(row.score),
      grade: row.grade,
      badges: parseJson(row.badges, []),
      auditedAt: row.audited_at,
    }))

    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': CACHE_CONTROL } })
  } catch (error) {
    console.error('[GET_NFT_AUDITS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

/**
 * @file api/v1/nfts/collections/[networkId]/[address]/traits/route.js
 * @description Trait facets for one collection — the option list behind the collection
 * page's attribute filter, and the counts shown next to each value.
 *
 * Traits are not log-derived, so cidex has nothing to index here: they arrive inside a
 * token's metadata document and land in nft_metadata_cache the first time that token is
 * rendered. This route reads that cache, scoped to tokens that actually carry a listing in
 * the requested status — a facet the grid can't show anything for is a dead end, not a
 * filter. `meta` reports how much of the collection has resolved so the UI can say so.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Same keys the listings route takes, so the panel and the grid always agree on what
// "this view" means
const STATUS_BY_KEY = { active: [1], sold: [2], cancelled: [3], active_sold: [1, 2], all: [1, 2, 3] }

// A ceiling on how many cached tokens one call reads. Attributes are longtext, so an
// unbounded scan of a large collection would pull megabytes to build a filter panel; past
// this the counts are a sample and `meta.truncated` says so.
const SCAN_LIMIT = 4000

// Collections that mint free-form traits (dates, serial numbers, wallet addresses) produce a
// value list nobody can filter with. Keep the busiest values and drop the tail.
const MAX_VALUES_PER_LABEL = 200

// Facets change as tokens resolve into the cache, so this is a short-lived answer
const CACHE_CONTROL = 'public, max-age=30, s-maxage=120, stale-while-revalidate=600'

const COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

// Separator for the seen-pair key. A tab can't appear in either half after the trim above,
// so "a<TAB>b" + "c" can never collide with "a" + "b<TAB>c".
const PAIR_SEPARATOR = '\t'

/**
 * Roll a batch of cached attribute documents up into [{label, values: [{value, count}]}].
 * Counts are per token: a document that repeats the same pair (some collections list a
 * trait twice) still counts once.
 */
function buildFacets(rows) {
  const groups = new Map()

  for (const row of rows) {
    let attributes
    try {
      attributes = JSON.parse(row.attributes)
    } catch {
      // A malformed document is one token's problem, not the panel's
      continue
    }
    if (!Array.isArray(attributes)) continue

    const seen = new Set()
    for (const attr of attributes) {
      const label = typeof attr?.label === 'string' ? attr.label.trim() : ''
      const value = attr?.value === null || attr?.value === undefined ? '' : String(attr.value).trim()
      if (!label || !value) continue

      const pair = `${label}${PAIR_SEPARATOR}${value}`
      if (seen.has(pair)) continue
      seen.add(pair)

      let values = groups.get(label)
      if (!values) {
        values = new Map()
        groups.set(label, values)
      }
      values.set(value, (values.get(value) || 0) + 1)
    }
  }

  return [...groups.entries()]
    .map(([label, values]) => ({
      label,
      values: [...values.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || COLLATOR.compare(a.value, b.value))
        .slice(0, MAX_VALUES_PER_LABEL),
    }))
    .sort((a, b) => COLLATOR.compare(a.label, b.label))
}

export async function GET(request, { params }) {
  try {
    const { networkId, address } = await params
    const { searchParams } = new URL(request.url)

    if (!/^\d+$/.test(String(networkId)) || !/^0x[0-9a-fA-F]{40}$/.test(String(address))) {
      return NextResponse.json({ success: false, error: 'A numeric networkId and a collection address are required' }, { status: 400 })
    }

    const collection = String(address).toLowerCase()
    const statuses = STATUS_BY_KEY[searchParams.get('status')] || STATUS_BY_KEY.active
    const placeholders = statuses.map(() => '?').join(',')

    // How much of what the grid can show is actually described by the facets below. The two
    // numbers differ for every token nobody has rendered yet — its traits are unknown, so
    // filtering would hide it, and the panel has to be able to admit that.
    const [[counts]] = await pool.execute(
      `SELECT COUNT(DISTINCT l.token_id) AS listed,
              COUNT(DISTINCT m.token_id) AS resolved
         FROM nft_listings l
         LEFT JOIN nft_metadata_cache m
           ON m.network_id = l.network_id AND m.collection = l.collection AND m.token_id = l.token_id
        WHERE l.network_id = ? AND l.collection = ? AND l.status IN (${placeholders})`,
      [networkId, collection, ...statuses],
    )

    // Driven from the cache's primary key, with the listing check as an indexed lookup on
    // nft_listings' idx_token — the reverse order would scan every listing to find the few
    // that have metadata.
    const [rows] = await pool.execute(
      `SELECT m.attributes
         FROM nft_metadata_cache m
        WHERE m.network_id = ? AND m.collection = ?
          AND m.attributes IS NOT NULL AND m.attributes <> '[]'
          AND EXISTS (
            SELECT 1 FROM nft_listings l
             WHERE l.network_id = m.network_id AND l.collection = m.collection
               AND l.token_id = m.token_id AND l.status IN (${placeholders})
          )
        LIMIT ?`,
      [networkId, collection, ...statuses, SCAN_LIMIT],
    )

    return NextResponse.json(
      {
        success: true,
        data: buildFacets(rows),
        meta: {
          listed: Number(counts?.listed) || 0,
          resolved: Number(counts?.resolved) || 0,
          truncated: rows.length >= SCAN_LIMIT,
        },
      },
      { headers: { 'Cache-Control': CACHE_CONTROL } },
    )
  } catch (error) {
    console.error('[GET_NFT_COLLECTION_TRAITS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

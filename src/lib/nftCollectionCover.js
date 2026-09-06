/**
 * @file lib/nftCollectionCover.js
 * @description What a collection needs to be shown as a collection: the identity it was
 * given onchain (name, icon, banner), and a few of the tokens listed inside it to fall back
 * to when it was given none.
 *
 * Both are attached to an already-computed rollup rather than joined into it — the market's
 * collection queries are GROUP BY aggregations, and a per-collection detail table has no
 * business in their grouping. One extra round trip each, whatever the row count.
 */

import pool from '@/lib/db'
import { COLLECTION_SAMPLE_LIMIT } from '@/lib/collectionArtwork'

// (network_id, collection) pairs as a row-constructor IN list — the same key both tables
// carry, and the only way to ask for many collections in one statement.
const keysOf = (rows) => rows.map((row) => [row.network_id, row.collection])
const placeholders = (keys) => keys.map(() => '(?,?)').join(',')

/**
 * Attaches `name`, `icon_uri` and `banner_uri` from nft_collection_cache.
 *
 * Read-through, so a collection nothing has resolved yet simply has none of the three and
 * the surface falls back on its own; the ranking route's backfill fills those rows in over
 * a page view or two, for every reader after.
 * @param {Array<Object>} rows Collection rows, mutated in place.
 * @returns {Promise<Array<Object>>} The same rows.
 */
export async function attachCollectionIdentities(rows) {
  if (!rows.length) return rows

  const keys = keysOf(rows)
  const [identities] = await pool.execute(
    `SELECT network_id, collection, name, symbol, icon_uri, banner_uri, total_supply
       FROM nft_collection_cache
      WHERE (network_id, collection) IN (${placeholders(keys)})`,
    keys.flat(),
  )

  const byCollection = new Map(identities.map((identity) => [`${identity.network_id}-${identity.collection}`, identity]))

  for (const row of rows) {
    const identity = byCollection.get(`${row.network_id}-${row.collection}`)
    row.name = identity?.name || null
    row.symbol = identity?.symbol || null
    row.icon_uri = identity?.icon_uri || null
    row.banner_uri = identity?.banner_uri || null
    row.total_supply = identity?.total_supply ?? null
  }

  return rows
}

/**
 * Attaches `samples` — the most recently listed token ids per collection, for the cover
 * mosaic a collection without artwork of its own falls back to. Ranked in SQL rather than
 * fetched per collection so it stays one round trip however many collections show.
 * @param {Array<Object>} rows Collection rows, mutated in place.
 * @param {number} [limit=COLLECTION_SAMPLE_LIMIT] Samples per collection.
 * @returns {Promise<Array<Object>>} The same rows.
 */
export async function attachCollectionSamples(rows, limit = COLLECTION_SAMPLE_LIMIT) {
  if (!rows.length) return rows

  const keys = keysOf(rows)
  const [samples] = await pool.execute(
    `SELECT network_id, collection, token_id, is_lsp8
       FROM (
         SELECT l.network_id, l.collection, l.token_id, l.is_lsp8,
                ROW_NUMBER() OVER (PARTITION BY l.network_id, l.collection ORDER BY l.listed_at DESC) AS rn
           FROM nft_listings l
          WHERE l.status = 1 AND l.backed = 1 AND (l.network_id, l.collection) IN (${placeholders(keys)})
       ) ranked
      WHERE rn <= ?`,
    [...keys.flat(), limit],
  )

  const byCollection = new Map()
  for (const sample of samples) {
    const key = `${sample.network_id}-${sample.collection}`
    if (!byCollection.has(key)) byCollection.set(key, [])
    byCollection.get(key).push({ token_id: sample.token_id, is_lsp8: sample.is_lsp8 })
  }

  for (const row of rows) row.samples = byCollection.get(`${row.network_id}-${row.collection}`) || []

  return rows
}

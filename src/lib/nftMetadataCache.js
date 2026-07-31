/**
 * @file lib/nftMetadataCache.js
 * @description Server-only read-through cache for NFT display metadata, backed by the
 * nft_metadata_cache table. Turns the 5-read RPC fan-out per LSP8 token into one indexed
 * row lookup, shared across every visitor instead of per-browser-session.
 *
 * This is on-demand read caching, not event scanning — it stays in the app rather than
 * moving to cidex, which owns log-derived tables. The table's DDL still ships with the
 * rest of the schema in cidex/scripts/add-nft-metadata-cache.sql.
 *
 * Every DB interaction degrades to a warning: if MariaDB is unreachable the resolver still
 * answers from RPC, just without the cache.
 */

import pool from '@/lib/db'
import { getServerPublicClient } from '@/lib/serverPublicClient'
import { resolveNftMetadata } from '@/lib/nftMetadata'
import { isLuksoIndexerChain, fetchLuksoTokenMetadata } from '@/lib/luksoIndexer'

// Onchain-rendered collections can be dynamic (Burnt Pix artwork evolves as it is refined),
// so entries expire rather than being treated as permanent the way an IPFS CID could be.
const TTL_MS = 7 * 24 * 60 * 60 * 1000

// A row whose `source` is null means the onchain pointer resolved but the document behind it
// did not come back — a gateway timeout, or a collection's own host rate-limiting us
// (chillwhales' S3 bucket answers 503 SlowDownRead under load). Those are transient, so they
// get a short backoff instead of the full TTL: long enough to stop hammering a struggling
// host, short enough that artwork reappears on its own rather than staying blank for a week.
const NEGATIVE_TTL_MS = 10 * 60 * 1000

// Indexer answers are a stand-in for a collection host that was failing at resolve time,
// so they are re-checked against the canonical onchain path on a much shorter clock — the
// artwork comes back within hours of the collection recovering, not a week later.
const INDEXER_TTL_MS = 6 * 60 * 60 * 1000

// Onchain reads can succeed while the offchain document fails, leaving a row with a
// collection name but no artwork. `source` is what distinguishes the two.
const isComplete = (row) => Boolean(row.source)

const ttlFor = (source) => {
  if (!source) return NEGATIVE_TTL_MS
  if (source === 'indexer') return INDEXER_TTL_MS
  return TTL_MS
}

// Guards a hostile or broken contract from writing an unbounded blob into the row.
// MEDIUMTEXT tops out at 16MB; refuse well before that.
const MAX_IMAGE_URI_BYTES = 8 * 1024 * 1024

const normalizeKey = ({ chainId, collection, tokenId }) => ({
  networkId: Number(chainId),
  collection: String(collection).toLowerCase(),
  tokenId: String(tokenId).toLowerCase(),
})

const parseAttributes = (raw) => {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const rowToMetadata = (row) => ({
  name: row.name || null,
  collectionName: row.collection_name || null,
  description: row.description || null,
  image: row.image_uri || null,
  attributes: parseAttributes(row.attributes),
  source: row.source || null,
})

const readRow = async (key) => {
  const [rows] = await pool.execute(
    `SELECT name, collection_name, description, image_uri, attributes, source, fetched_at
       FROM nft_metadata_cache
      WHERE network_id = ? AND collection = ? AND token_id = ?
      LIMIT 1`,
    [key.networkId, key.collection, key.tokenId],
  )
  return rows[0] || null
}

const writeRow = async (key, isLsp8, metadata) => {
  const imageUri = metadata.image && Buffer.byteLength(metadata.image, 'utf8') <= MAX_IMAGE_URI_BYTES ? metadata.image : null

  await pool.execute(
    `INSERT INTO nft_metadata_cache
       (network_id, collection, token_id, is_lsp8, name, collection_name, description, image_uri, attributes, source, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       is_lsp8 = VALUES(is_lsp8),
       name = VALUES(name),
       collection_name = VALUES(collection_name),
       description = VALUES(description),
       image_uri = VALUES(image_uri),
       attributes = VALUES(attributes),
       source = VALUES(source),
       fetched_at = VALUES(fetched_at)`,
    [
      key.networkId,
      key.collection,
      key.tokenId,
      isLsp8 ? 1 : 0,
      metadata.name,
      metadata.collectionName,
      metadata.description,
      imageUri,
      JSON.stringify(metadata.attributes || []),
      metadata.source,
    ],
  )
}

// Restarts the backoff clock without touching the row's contents, so a re-resolution that
// came back empty can't demote artwork we already have.
const touchRow = async (key) => {
  await pool.execute(
    `UPDATE nft_metadata_cache SET fetched_at = NOW()
      WHERE network_id = ? AND collection = ? AND token_id = ?`,
    [key.networkId, key.collection, key.tokenId],
  )
}

/**
 * Resolves a token's metadata, preferring a fresh cached row over an RPC read.
 * @param {Object} params
 * @param {number|string} params.chainId Chain the collection lives on.
 * @param {string} params.collection NFT contract address.
 * @param {string} params.tokenId bytes32 hex for LSP8, decimal for ERC721.
 * @param {boolean} params.isLsp8 True for LSP8 collections.
 * @param {string} [params.baseUrl] Absolute origin, for resolving proxy-relative storage URLs.
 * @param {boolean} [params.allowStale=false] Serve an expired row instead of re-reading —
 * used by the image proxy, which only needs the artwork reference and would rather answer
 * from a stale row than block a render on RPC.
 * @returns {Promise<{metadata: Object, cached: boolean}|null>} null when the chain is
 * unconfigured or the read failed outright.
 */
export const getNftMetadata = async ({ chainId, collection, tokenId, isLsp8, baseUrl, allowStale = false }) => {
  const key = normalizeKey({ chainId, collection, tokenId })

  let row = null
  try {
    row = await readRow(key)
  } catch (error) {
    console.warn('[nft-metadata-cache] read failed, falling back to RPC:', error.message)
  }

  if (row) {
    const age = Date.now() - new Date(row.fetched_at).getTime()
    const complete = isComplete(row)
    // `allowStale` is a latency shortcut for callers that just need the artwork reference,
    // so it only applies to rows that actually resolved. Serving an expired failure forever
    // would turn one bad gateway response into permanently missing art.
    if ((allowStale && complete) || age < ttlFor(row.source)) {
      return { metadata: rowToMetadata(row), cached: true }
    }
  }

  const publicClient = getServerPublicClient(key.networkId)
  if (!publicClient) {
    // Unknown chain — a stale row still beats nothing.
    return row ? { metadata: rowToMetadata(row), cached: true } : null
  }

  let metadata
  try {
    metadata = await resolveNftMetadata({
      publicClient,
      collection: key.collection,
      // The contract call needs the token id exactly as the caller supplied it; only the
      // cache key is lowercased.
      tokenId,
      isLsp8,
      baseUrl,
    })
  } catch (error) {
    console.warn('[nft-metadata-cache] RPC resolution failed:', error.message)
    return row ? { metadata: rowToMetadata(row), cached: true } : null
  }

  // The contract's pointer resolved to nothing fetchable — usually the collection's own
  // host is down. LUKSO mainnet has an indexer holding what it scraped while that host was
  // alive, which is the difference between a named card with traits and a bare placeholder.
  // Strictly additive: it only runs once the onchain path has already come back empty.
  if (!metadata.source && isLuksoIndexerChain(key.networkId)) {
    try {
      const indexed = await fetchLuksoTokenMetadata({ collection: key.collection, tokenId })
      if (indexed) {
        metadata = {
          ...indexed,
          // The onchain LSP4TokenName read succeeds even when the metadata document does
          // not, so keep it when the indexer has no better answer.
          collectionName: indexed.collectionName || metadata.collectionName,
        }
      }
    } catch (error) {
      console.warn('[nft-metadata-cache] LUKSO indexer fallback failed:', error.message)
    }
  }

  // A resolution that lost the offchain document must never overwrite one that had it —
  // otherwise a single bad minute from a gateway blanks artwork that was already working.
  if (!metadata.source && row && isComplete(row)) {
    try {
      await touchRow(key)
    } catch (error) {
      console.warn('[nft-metadata-cache] touch failed:', error.message)
    }
    return { metadata: rowToMetadata(row), cached: true }
  }

  try {
    await writeRow(key, isLsp8, metadata)
  } catch (error) {
    console.warn('[nft-metadata-cache] write failed:', error.message)
  }

  return { metadata, cached: false }
}

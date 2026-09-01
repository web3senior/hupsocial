/**
 * @file lib/collectionMetadataCache.js
 * @description Server-only read-through cache for collection-level display metadata, backed
 * by the nft_collection_cache table — the collection-shaped sibling of nftMetadataCache.
 * Stale-while-revalidate: any existing row answers the request immediately; TTL expiry
 * re-resolves from chain after the response, never inside it.
 *
 * On-demand read caching, not event scanning — it stays in the app rather than moving to
 * cidex, which owns log-derived tables. The DDL ships with the rest of the schema in
 * cidex/scripts/add-nft-collection-cache.sql.
 *
 * Every DB interaction degrades to a warning: if MariaDB is unreachable the resolver still
 * answers from RPC, just without the cache.
 */

import { after } from 'next/server'
import pool from '@/lib/db'
import { getServerPublicClient } from '@/lib/serverPublicClient'
import { resolveCollectionMetadata } from '@/lib/collectionMetadata'
import { isLuksoIndexerChain, fetchLuksoCollectionMetadata } from '@/lib/luksoIndexer'
import { LSP4_TOKEN_NAME_KEY, erc725yGetDataAbi } from '@/lib/lsp4'

// Shorter than the token cache's week: total_supply moves while a collection is minting,
// and a day-old supply is stale in a way day-old artwork is not.
const TTL_MS = 24 * 60 * 60 * 1000

// A row whose source is null means an LSP4Metadata pointer exists but the document behind
// it didn't come back — transient, so it backs off briefly instead of holding the TTL.
const NEGATIVE_TTL_MS = 10 * 60 * 1000

// Indexer answers stand in for a document that was failing at resolve time, so they are
// re-checked against the canonical onchain path on a shorter clock — same rule as the token
// cache — so the collection's own document takes over within hours of coming back.
const INDEXER_TTL_MS = 6 * 60 * 60 * 1000

const ttlFor = (row) => {
  if (!row.source) return NEGATIVE_TTL_MS
  if (row.source === 'indexer') return INDEXER_TTL_MS
  return TTL_MS
}

// Manual refresh triggers real RPC work, so it is rate limited — derived from the row's
// own fetched_at rather than an in-memory counter, same as the token cache's refresh.
const REFRESH_COOLDOWN_MS = 60 * 1000

const isComplete = (row) => Boolean(row.source)

const normalizeKey = ({ chainId, collection }) => ({
  networkId: Number(chainId),
  collection: String(collection).toLowerCase(),
})

const parseJsonArray = (raw) => {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const rowToMetadata = (row) => ({
  name: row.name || null,
  symbol: row.symbol || null,
  description: row.description || null,
  banner: row.banner_uri || null,
  icon: row.icon_uri || null,
  creators: parseJsonArray(row.creators),
  links: parseJsonArray(row.links),
  totalSupply: row.total_supply || null,
  source: row.source || null,
  isLsp8: Boolean(row.is_lsp8),
})

const readRow = async (key) => {
  const [rows] = await pool.execute(
    `SELECT is_lsp8, name, symbol, description, banner_uri, icon_uri, creators, links, total_supply, source, fetched_at
       FROM nft_collection_cache
      WHERE network_id = ? AND collection = ?
      LIMIT 1`,
    [key.networkId, key.collection],
  )
  return rows[0] || null
}

// Inline data: URIs never enter the row: there is no per-collection image proxy to
// rasterize them, and a base64 banner would ride along in every API response.
const storableUri = (uri) => (uri && !uri.startsWith('data:') ? uri : null)

const writeRow = async (key, isLsp8, metadata) => {
  await pool.execute(
    `INSERT INTO nft_collection_cache
       (network_id, collection, is_lsp8, name, symbol, description, banner_uri, icon_uri, creators, links, total_supply, source, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       is_lsp8 = VALUES(is_lsp8),
       name = VALUES(name),
       symbol = VALUES(symbol),
       description = VALUES(description),
       banner_uri = VALUES(banner_uri),
       icon_uri = VALUES(icon_uri),
       creators = VALUES(creators),
       links = VALUES(links),
       total_supply = VALUES(total_supply),
       source = VALUES(source),
       fetched_at = VALUES(fetched_at)`,
    [
      key.networkId,
      key.collection,
      isLsp8 ? 1 : 0,
      metadata.name,
      metadata.symbol,
      metadata.description,
      storableUri(metadata.banner),
      storableUri(metadata.icon),
      JSON.stringify(metadata.creators || []),
      JSON.stringify(metadata.links || []),
      metadata.totalSupply,
      metadata.source,
    ],
  )
}

// Restarts the backoff clock without touching the row's contents, so a re-resolution that
// came back empty can't demote a banner and description we already have.
const touchRow = async (key) => {
  await pool.execute(`UPDATE nft_collection_cache SET fetched_at = NOW() WHERE network_id = ? AND collection = ?`, [key.networkId, key.collection])
}

/**
 * Works out whether a collection speaks LSP8, for callers that only have an address — the
 * collection page URL carries no standard hint. The market index already knows for anything
 * ever listed; a contract never listed here gets one probe: only an ERC725Y contract
 * answers getData at all.
 */
const detectIsLsp8 = async (key, publicClient) => {
  try {
    const [rows] = await pool.execute(`SELECT MAX(is_lsp8) AS is_lsp8 FROM nft_listings WHERE network_id = ? AND collection = ?`, [
      key.networkId,
      key.collection,
    ])
    if (rows[0]?.is_lsp8 !== null && rows[0]?.is_lsp8 !== undefined) return Boolean(Number(rows[0].is_lsp8))
  } catch (error) {
    console.warn('[collection-metadata-cache] standard lookup failed:', error.message)
  }

  try {
    await publicClient.readContract({ abi: erc725yGetDataAbi, address: key.collection, functionName: 'getData', args: [LSP4_TOKEN_NAME_KEY] })
    return true
  } catch {
    return false
  }
}

// One background re-resolve per collection at a time — concurrent stale hits all serve the
// row; only the first schedules the chain read.
const revalidating = new Set()

const scheduleRevalidate = (key, work) => {
  const guard = `${key.networkId}:${key.collection}`
  if (revalidating.has(guard)) return
  revalidating.add(guard)
  const task = async () => {
    try {
      await work()
    } catch (error) {
      console.warn('[collection-metadata-cache] background revalidate failed:', error.message)
    } finally {
      revalidating.delete(guard)
    }
  }
  try {
    after(task)
  } catch {
    // Outside a request scope (scripts, tests) there is no response to wait on
    void task()
  }
}

const resolveFromChain = async (key, { isLsp8, baseUrl, row }) => {
  const publicClient = getServerPublicClient(key.networkId)
  if (!publicClient) {
    // Unknown chain — a stale row still beats nothing.
    return row ? { metadata: rowToMetadata(row), cached: true } : null
  }

  // A nameless row's flag is the prime suspect for why it is nameless — a wrong-standard read
  // answers totalSupply but not name() — so only a named row's flag is reused.
  const resolvedIsLsp8 = typeof isLsp8 === 'boolean' ? isLsp8 : row?.name ? Boolean(row.is_lsp8) : await detectIsLsp8(key, publicClient)

  let metadata
  try {
    metadata = await resolveCollectionMetadata({ publicClient, collection: key.collection, isLsp8: resolvedIsLsp8, baseUrl })
  } catch (error) {
    console.warn('[collection-metadata-cache] RPC resolution failed:', error.message)
    return row ? { metadata: rowToMetadata(row), cached: true } : null
  }

  // The pointer resolved to nothing fetchable — the collection's own document is gone or its
  // host is down. LUKSO mainnet has an indexer holding what it scraped while that document
  // was alive, which is the difference between a header with its icon, banner and blurb and a
  // bare name. Strictly additive: it only runs once the onchain path has come back empty, and
  // name, symbol, creators and supply stay what the contract said.
  if (!metadata.source && resolvedIsLsp8 && isLuksoIndexerChain(key.networkId)) {
    try {
      const indexed = await fetchLuksoCollectionMetadata({ collection: key.collection })
      if (indexed) metadata = { ...metadata, ...indexed }
    } catch (error) {
      console.warn('[collection-metadata-cache] LUKSO indexer fallback failed:', error.message)
    }
  }

  // A resolution that lost the offchain document must never overwrite one that had it —
  // otherwise one bad minute from a gateway blanks a banner that was already working.
  // Likewise a nameless result never replaces a named row: names don't vanish onchain, so
  // that is the signature of a wrong-standard read (ERC721-style calls against LSP8 answer
  // totalSupply but not name()).
  if (row && ((!metadata.source && isComplete(row)) || (!metadata.name && row.name))) {
    try {
      await touchRow(key)
    } catch (error) {
      console.warn('[collection-metadata-cache] touch failed:', error.message)
    }
    return { metadata: rowToMetadata(row), cached: true }
  }

  try {
    await writeRow(key, resolvedIsLsp8, metadata)
  } catch (error) {
    console.warn('[collection-metadata-cache] write failed:', error.message)
  }

  return { metadata: { ...metadata, banner: storableUri(metadata.banner), icon: storableUri(metadata.icon), isLsp8: resolvedIsLsp8 }, cached: false }
}

/**
 * Resolves a collection's metadata, DB row first: any cached row answers immediately, and a
 * row past its TTL triggers a chain re-resolve after the response instead of blocking it.
 * Only a collection with no row at all resolves inline.
 * @param {Object} params
 * @param {number|string} params.chainId Chain the collection lives on.
 * @param {string} params.collection NFT contract address.
 * @param {boolean|null} [params.isLsp8] True/false when the caller knows the standard;
 * null/undefined to infer it (from the listings index, then an onchain probe).
 * @param {string} [params.baseUrl] Absolute origin, for resolving proxy-relative storage URLs.
 * @param {boolean} [params.forceRefresh=false] Re-read from chain synchronously, ignoring the
 * cached row's freshness. The row is still loaded, because it is what protects a good banner
 * from being demoted if this read comes back empty.
 * @returns {Promise<{metadata: Object, cached: boolean}|null>} null when the chain is
 * unconfigured or the read failed outright. metadata always carries isLsp8.
 */
export const getCollectionMetadata = async ({ chainId, collection, isLsp8 = null, baseUrl, forceRefresh = false }) => {
  const key = normalizeKey({ chainId, collection })

  let row = null
  try {
    row = await readRow(key)
  } catch (error) {
    console.warn('[collection-metadata-cache] read failed, falling back to RPC:', error.message)
  }

  if (row && !forceRefresh) {
    const age = Date.now() - new Date(row.fetched_at).getTime()
    if (age >= ttlFor(row)) {
      scheduleRevalidate(key, () => resolveFromChain(key, { isLsp8, baseUrl, row }))
    }
    return { metadata: rowToMetadata(row), cached: true }
  }

  return resolveFromChain(key, { isLsp8, baseUrl, row })
}

/**
 * Forces a collection's metadata to be re-read from chain, for when a collection updated
 * its banner, description or links and would otherwise wait out the 24h TTL. Throttled per
 * collection off the row's own timestamp — a collection nobody touched refreshes instantly,
 * repeated clicks on the same one are refused.
 * @param {Object} params Same shape as getCollectionMetadata.
 * @returns {Promise<{throttled: true, retryAfterSeconds: number} | {throttled: false, metadata: Object|null}>}
 */
export const refreshCollectionMetadata = async ({ chainId, collection, baseUrl }) => {
  const key = normalizeKey({ chainId, collection })

  let row = null
  try {
    row = await readRow(key)
  } catch (error) {
    console.warn('[collection-metadata-cache] refresh read failed:', error.message)
  }

  if (row) {
    const age = Date.now() - new Date(row.fetched_at).getTime()
    if (age < REFRESH_COOLDOWN_MS) {
      return { throttled: true, retryAfterSeconds: Math.max(1, Math.ceil((REFRESH_COOLDOWN_MS - age) / 1000)) }
    }
  }

  const result = await getCollectionMetadata({ chainId, collection, baseUrl, forceRefresh: true })
  return { throttled: false, metadata: result ? result.metadata : null }
}

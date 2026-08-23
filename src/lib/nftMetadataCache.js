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

import { after } from 'next/server'
import pool from '@/lib/db'
import { getServerPublicClient } from '@/lib/serverPublicClient'
import { resolveNftMetadata, tokenExists } from '@/lib/nftMetadata'
import { isLuksoIndexerChain, fetchLuksoTokenMetadata } from '@/lib/luksoIndexer'
import { mapWithConcurrency } from '@/lib/concurrency'

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

// Manual refresh triggers real RPC work, so it is rate limited — but the limit is derived
// from the row's own fetched_at rather than an in-memory counter, which keeps it correct
// across serverless instances without any shared state to provision.
const REFRESH_COOLDOWN_MS = 60 * 1000

// Sweeping a collection is orders of magnitude heavier than one token, so it gets a longer
// cooldown — applied per row, exactly like the single-token one. That single rule does double
// duty: it rate limits the sweep, and it makes the sweep resumable, because a call that
// refreshed the stalest rows leaves the rest still eligible for the call right behind it.
const COLLECTION_REFRESH_COOLDOWN_MS = 5 * 60 * 1000

// How much of a collection one call takes on. Bounded so the request answers well inside a
// serverless timeout however large the collection is; the caller repeats until nothing is
// left, which is also what turns the sweep into something it can show progress for.
const COLLECTION_REFRESH_BATCH = 24
const COLLECTION_REFRESH_CONCURRENCY = 8

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
  // model_type is never null while model_uri is set — the resolver only keeps a file whose
  // format it recognized, so the pair is written and read together.
  model: row.model_uri ? { url: row.model_uri, fileType: row.model_type || null } : null,
  attributes: parseAttributes(row.attributes),
  source: row.source || null,
})

const readRow = async (key) => {
  const [rows] = await pool.execute(
    `SELECT name, collection_name, description, image_uri, model_uri, model_type, attributes, source, fetched_at
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
       (network_id, collection, token_id, is_lsp8, name, collection_name, description, image_uri, model_uri, model_type, attributes, source, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       is_lsp8 = VALUES(is_lsp8),
       name = VALUES(name),
       collection_name = VALUES(collection_name),
       description = VALUES(description),
       image_uri = VALUES(image_uri),
       model_uri = VALUES(model_uri),
       model_type = VALUES(model_type),
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
      metadata.model?.url || null,
      metadata.model?.fileType || null,
      JSON.stringify(metadata.attributes || []),
      metadata.source,
    ],
  )
}

// Rows are normally never deleted — the set only grows. The exception is a row that turned out
// not to be a token of this collection at all, which both the read path above and the sweep at
// the bottom of the file drop once ownership says the id has no owner.
const deleteRow = async (key) => {
  await pool.execute(`DELETE FROM nft_metadata_cache WHERE network_id = ? AND collection = ? AND token_id = ?`, [
    key.networkId,
    key.collection,
    key.tokenId,
  ])
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

// Resolutions in progress, by cache key. A grid mounting, the image proxy redirecting and an
// OG card rendering can all ask for the same token inside one instance at once; the RPC
// fan-out and the gateway round trip are paid once, and the row is written once.
const inflight = new Map()

const inflightKeyOf = (key) => `${key.networkId}|${key.collection}|${key.tokenId}`

// Runs `task` once the response is out the door. `after` is the platform's way of keeping the
// function alive past the response; it only exists inside a request scope, which every caller
// of this module is today — anything else (a script, say) runs it detached instead.
const runAfterResponse = (task) => {
  try {
    after(task)
  } catch {
    task()
  }
}

/**
 * Resolves a token's metadata, preferring a cached row over an RPC read.
 *
 * Freshness is served-then-checked, not checked-then-served: a row that resolved once is
 * answered from immediately even past its TTL, and the re-read happens after the response.
 * The re-read is what used to make a collection with a dead metadata host unusable — every
 * token of it stalled a render on a gateway timeout every time its TTL lapsed, when the
 * cached answer was sitting right there. Only a row that never resolved (or no row at all)
 * has nothing to say, and waits.
 *
 * @param {Object} params
 * @param {number|string} params.chainId Chain the collection lives on.
 * @param {string} params.collection NFT contract address.
 * @param {string} params.tokenId bytes32 hex for LSP8, decimal for ERC721.
 * @param {boolean} params.isLsp8 True for LSP8 collections.
 * @param {string} [params.baseUrl] Absolute origin, for resolving proxy-relative storage URLs.
 * @param {boolean} [params.allowStale=false] Serve an expired row without scheduling the
 * re-read — for the image proxy and OG renderer, which only need the artwork reference and
 * fire far too often to own refreshing; the metadata route does that.
 * @param {boolean} [params.forceRefresh=false] Ignore the cached row's freshness and
 * re-read from chain. The row is still loaded, because it is what protects good artwork
 * from being demoted if this read comes back empty.
 * @returns {Promise<{metadata: Object, cached: boolean}|null>} null when the chain is
 * unconfigured or the read failed outright.
 */
export const getNftMetadata = async ({ chainId, collection, tokenId, isLsp8, baseUrl, allowStale = false, forceRefresh = false }) => {
  const key = normalizeKey({ chainId, collection, tokenId })

  let row = null
  try {
    row = await readRow(key)
  } catch (error) {
    console.warn('[nft-metadata-cache] read failed, falling back to RPC:', error.message)
  }

  if (row && !forceRefresh) {
    const age = Date.now() - new Date(row.fetched_at).getTime()
    const complete = isComplete(row)
    if (age < ttlFor(row.source)) {
      return { metadata: rowToMetadata(row), cached: true }
    }
    // Expired. A resolved row is still the right answer for this render — only a row that
    // never resolved has nothing to show, and that one waits. Serving an expired failure
    // forever would turn one bad gateway response into permanently missing art.
    if (complete) {
      if (!allowStale) {
        runAfterResponse(() =>
          resolveAndStore({ key, row, tokenId, isLsp8, baseUrl }).catch((error) => {
            console.warn('[nft-metadata-cache] background re-read failed:', error.message)
          }),
        )
      }
      return { metadata: rowToMetadata(row), cached: true }
    }
  }

  return resolveAndStore({ key, row, tokenId, isLsp8, baseUrl })
}

// The resolve half of getNftMetadata, deduplicated per token across whatever is asking.
const resolveAndStore = (params) => {
  const id = inflightKeyOf(params.key)
  const pending = inflight.get(id)
  if (pending) return pending

  const task = resolveToken(params).finally(() => inflight.delete(id))
  inflight.set(id, task)
  return task
}

// Reads the token from chain (and, failing the document, the LUKSO indexer), proves it
// exists, and writes the row — or leaves a better row alone. `row` is what the caller had
// cached, if anything.
const resolveToken = async ({ key, row, tokenId, isLsp8, baseUrl }) => {
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

  // This table doubles as the collection browse's token list — every row in it is presented as
  // part of the collection. Metadata alone can't tell a token from a typo: an id that was never
  // minted still resolves to *something*, either the collection's own document or a base URI the
  // id gets appended to, whose 404 still leaves the collection's name behind. So ownership is
  // asked on the way in, which keeps a mistyped sell-modal preview out, and on every later
  // re-read, which is what takes an already-cached ghost — or a token burned since — back off the
  // grid without waiting for someone to run the collection sweep by hand. Guarding only the
  // insert left the ghosts already in the table immortal: a row that fails to resolve is re-read
  // every NEGATIVE_TTL_MS and was rewritten unquestioned each time.
  //
  // A token-specific document is proof enough, and the row remembers that proof, so the common
  // case stays free: a real token whose gateway is having a bad minute resolves to a null source
  // here without buying the ownership read again.
  const proved = metadata.source === 'token' || row?.source === 'token'
  if (!proved && (await tokenExists({ publicClient, collection: key.collection, tokenId, isLsp8 })) === false) {
    if (row) {
      try {
        await deleteRow(key)
      } catch (error) {
        console.warn('[nft-metadata-cache] ghost row delete failed:', error.message)
      }
    }
    return { metadata, cached: false }
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

/**
 * Forces a token's metadata to be re-read from chain, for when a collection has updated its
 * onchain metadata and would otherwise wait out the cache TTL before anyone saw the change.
 *
 * Throttled per token off the row's own timestamp. That also makes the throttle self-tuning
 * in the useful direction: a token nobody has touched in days refreshes instantly, while
 * repeated clicks on the same one are refused.
 *
 * @param {Object} params Same shape as getNftMetadata.
 * @returns {Promise<{throttled: true, retryAfterSeconds: number} | {throttled: false, metadata: Object}>}
 */
export const refreshNftMetadata = async ({ chainId, collection, tokenId, isLsp8, baseUrl }) => {
  const key = normalizeKey({ chainId, collection, tokenId })

  let row = null
  try {
    row = await readRow(key)
  } catch (error) {
    console.warn('[nft-metadata-cache] refresh read failed:', error.message)
  }

  if (row) {
    const age = Date.now() - new Date(row.fetched_at).getTime()
    if (age < REFRESH_COOLDOWN_MS) {
      return { throttled: true, retryAfterSeconds: Math.max(1, Math.ceil((REFRESH_COOLDOWN_MS - age) / 1000)) }
    }
  }

  const result = await getNftMetadata({ chainId, collection, tokenId, isLsp8, baseUrl, forceRefresh: true })
  if (!result) return { throttled: false, metadata: null }

  return { throttled: false, metadata: result.metadata }
}

/**
 * How much of a collection ships a 3D file, for the collection page's 3D badge.
 *
 * Token-derived on purpose: LSP4 hangs the mesh off the token, not the contract, so "this
 * collection is 3D" is only ever a statement about its tokens. And it is a statement about
 * the ones this app has resolved — a collection nobody has browsed has no rows here — so the
 * caller gets `cached` alongside `models` and can say which it means.
 *
 * @param {Object} params
 * @param {number|string} params.chainId Chain the collection lives on.
 * @param {string} params.collection NFT contract address.
 * @returns {Promise<{cached: number, models: number, types: string[]}>} Zeroed when the
 * collection has no cached tokens, and when the database is unreachable — a badge is not
 * worth failing a page load over.
 */
export const getCollectionModelStats = async ({ chainId, collection }) => {
  const empty = { cached: 0, models: 0, types: [] }

  try {
    const [[row]] = await pool.execute(
      `SELECT COUNT(*) AS cached,
              SUM(model_uri IS NOT NULL) AS models,
              GROUP_CONCAT(DISTINCT model_type ORDER BY model_type SEPARATOR ',') AS types
         FROM nft_metadata_cache
        WHERE network_id = ? AND collection = ?`,
      [Number(chainId), String(collection).toLowerCase()],
    )

    return {
      cached: Number(row?.cached) || 0,
      models: Number(row?.models) || 0,
      // model_type is never null while model_uri is set, so this lists exactly the formats
      // the collection ships — usually one
      types: row?.types ? String(row.types).split(',').filter(Boolean) : [],
    }
  } catch (error) {
    console.warn('[nft-metadata-cache] model stats failed:', error.message)
    return empty
  }
}

/**
 * Re-reads a batch of one collection's cached tokens from chain — the whole-collection form of
 * refreshNftMetadata, for when a change was made to every token rather than one of them.
 *
 * "The collection" is the set of its tokens this app has cached, which is precisely the set
 * that can be showing something stale. A token nobody has viewed has no row, and resolves from
 * chain the first time somebody does.
 *
 * One call handles at most COLLECTION_REFRESH_BATCH tokens, stalest first, skipping any row
 * refreshed within the cooldown. Repeat until `remaining` is zero to walk a whole collection;
 * each call is guaranteed to advance, because every row it touches gets a new fetched_at even
 * when the re-read failed.
 *
 * It is also the cache's only garbage collection: a row whose token has no owner onchain is
 * deleted rather than re-read, which is what takes a burned token — or an id that was cached
 * from a mistyped preview and never existed — back out of the collection's browse grid.
 *
 * @param {Object} params
 * @param {number|string} params.chainId Chain the collection lives on.
 * @param {string} params.collection NFT contract address.
 * @param {string} [params.baseUrl] Absolute origin, for resolving proxy-relative storage URLs.
 * @returns {Promise<{total: number, processed: number, refreshed: number, removed: number,
 * failed: number, remaining: number}>} `total` counts every cached token in the collection
 * (before this batch's removals); `remaining` counts those still stale after it.
 */
export const refreshCollectionMetadata = async ({ chainId, collection, baseUrl }) => {
  const networkId = Number(chainId)
  const address = String(collection).toLowerCase()
  // Inlined rather than bound: it is a module constant, never caller input, and an INTERVAL
  // unit takes a literal more predictably than a prepared-statement placeholder.
  const staleCutoff = `NOW() - INTERVAL ${Math.ceil(COLLECTION_REFRESH_COOLDOWN_MS / 1000)} SECOND`

  // Both numbers come from one pass: how much of this collection is cached at all, and how
  // much of it the cooldown still lets us touch.
  const [[counts]] = await pool.execute(
    `SELECT COUNT(*) AS total,
            SUM(fetched_at < ${staleCutoff}) AS pending
       FROM nft_metadata_cache
      WHERE network_id = ? AND collection = ?`,
    [networkId, address],
  )

  const total = Number(counts?.total) || 0
  const pending = Number(counts?.pending) || 0

  if (pending === 0) return { total, processed: 0, refreshed: 0, removed: 0, failed: 0, remaining: 0 }

  const [rows] = await pool.execute(
    `SELECT token_id, is_lsp8
       FROM nft_metadata_cache
      WHERE network_id = ? AND collection = ? AND fetched_at < ${staleCutoff}
      ORDER BY fetched_at ASC
      LIMIT ?`,
    [networkId, address, COLLECTION_REFRESH_BATCH],
  )

  const publicClient = getServerPublicClient(networkId)

  const results = await mapWithConcurrency(rows, COLLECTION_REFRESH_CONCURRENCY, async (row) => {
    const key = { networkId, collection: address, tokenId: String(row.token_id).toLowerCase() }

    // The sweep is also the collection's chance to shed rows that were never its tokens — an id
    // resolved once from a typo, or a token burned since it was cached. Nothing else takes them
    // out, and the browse grid presents every row here as part of the collection. Only a
    // definite "no owner" removes anything; an RPC that simply didn't answer leaves the row be.
    if (publicClient) {
      const exists = await tokenExists({ publicClient, collection: address, tokenId: row.token_id, isLsp8: Boolean(row.is_lsp8) })
      if (exists === false) {
        try {
          await deleteRow(key)
          return 'removed'
        } catch (error) {
          console.warn('[nft-metadata-cache] ghost row delete failed for token', row.token_id, '-', error.message)
        }
      }
    }

    try {
      const result = await getNftMetadata({
        chainId: networkId,
        collection: address,
        tokenId: row.token_id,
        isLsp8: Boolean(row.is_lsp8),
        baseUrl,
        forceRefresh: true,
      })
      if (result) return true
    } catch (error) {
      console.warn('[nft-metadata-cache] collection refresh failed for token', row.token_id, '-', error.message)
    }

    // Nothing was written for this token, so its fetched_at is still whatever it was — and
    // since the batch is picked stalest-first, the next call would select the very same token
    // and the sweep would never move past it. Stamping it here backs a dead contract or
    // unreachable gateway off with everything else instead of blocking the collection.
    try {
      await touchRow(key)
    } catch (error) {
      console.warn('[nft-metadata-cache] collection refresh touch failed:', error.message)
    }
    return false
  })

  const refreshed = results.filter((result) => result === true).length
  const removed = results.filter((result) => result === 'removed').length

  return {
    total,
    processed: rows.length,
    refreshed,
    removed,
    failed: rows.length - refreshed - removed,
    remaining: Math.max(0, pending - rows.length),
  }
}

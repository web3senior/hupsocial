/**
 * @file lib/luksoIndexer.js
 * @description LUKSO Envio indexer (the backend Universal Everything reads from) —
 * pre-resolved LSP8 token metadata for LUKSO mainnet.
 *
 * This is a LAST RESORT, consulted only after the contract's own metadata pointer fails
 * to produce a document. That ordering is the whole point: an earlier version of this
 * module ran first and was removed in bd43e69 because indexer hiccups broke tokens that
 * would have resolved fine onchain. Running last, it can only add metadata that would
 * otherwise be missing — it can never displace a working onchain read.
 *
 * What it buys: when a collection's own host goes down, the indexer still holds whatever
 * it scraped while that host was alive. chillwhales' S3 bucket started answering 503
 * SlowDownRead on every path; the indexer still has every listed token's name and traits,
 * so cards render properly instead of falling back to a bare placeholder.
 */

const LUKSO_MAINNET_ID = 42
const ENDPOINT = 'https://envio.lukso-mainnet.universal.tech/v1/graphql'

// We are already on the slow path by the time this runs, and the caller caches the result
// for hours — but a hung indexer must not hold a request open indefinitely.
const TIMEOUT_MS = 6000

const TOKEN_QUERY = `query ($id: String!) {
  Token(where: { id: { _eq: $id } }) {
    name
    lsp4TokenName
    description
    images(order_by: { width: desc }) { src url }
    icons(order_by: { width: desc }) { src url }
    attributes { key value }
    baseAsset { name lsp4TokenName }
  }
}`

// Prefer the api.universalprofile.cloud `src` (immutable-cached by the browser,
// resizable via ?width=) over the raw ipfs:// `url`
const pickUrl = (entry) => entry?.src || entry?.url || null

export const isLuksoIndexerChain = (chainId) => Number(chainId) === LUKSO_MAINNET_ID

/**
 * Resolves LSP8 token metadata from the indexer, in the shared normalized shape.
 *
 * Unlike the removed indexer-first version, a hit with no image still counts. Reaching
 * this function means the onchain path already came back empty, so a name and traits with
 * no artwork beats the nameless placeholder that is the only alternative.
 *
 * @param {{ collection: string, tokenId: string }} params Collection address and bytes32 token id.
 * @returns {Promise<{ name, collectionName, description, image, attributes, source } | null>}
 * null when the token isn't indexed, or the request fails or times out.
 */
export const fetchLuksoTokenMetadata = async ({ collection, tokenId }) => {
  const id = `${collection.toLowerCase()}-${String(tokenId).toLowerCase()}`

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: TOKEN_QUERY, variables: { id } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) return null

  const token = (await res.json())?.data?.Token?.[0]
  if (!token) return null

  const collectionName = token.baseAsset?.lsp4TokenName || token.baseAsset?.name || token.lsp4TokenName || null
  const image = pickUrl(token.images?.[0]) || pickUrl(token.icons?.[0])

  const attributes = (token.attributes || [])
    .filter((attr) => attr?.key && attr.value !== null && attr.value !== undefined && `${attr.value}`.trim() !== '')
    .map((attr) => ({ label: String(attr.key), value: String(attr.value) }))

  // A row with nothing worth showing is a miss, not a hit — let the caller record the
  // failure and retry on its short backoff instead of caching an empty answer.
  if (!image && !token.name && attributes.length === 0) return null

  return {
    name: token.name || token.lsp4TokenName || collectionName,
    collectionName,
    description: token.description || null,
    image,
    attributes,
    // Distinct from 'token' so the cache can re-check the canonical onchain source on a
    // much shorter clock than a normal successful resolution.
    source: 'indexer',
  }
}

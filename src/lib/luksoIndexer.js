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

import { isSameStoredImage } from '@/lib/storageHelper'

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
    // The indexer exposes images and icons but not the collection's `assets` files, so a
    // token that resolves here has no 3D model even when its document declares one.
    model: null,
    attributes,
    // Distinct from 'token' so the cache can re-check the canonical onchain source on a
    // much shorter clock than a normal successful resolution.
    source: 'indexer',
  }
}

// Mirrors MAX_LINKS in lib/collectionMetadata — the header shows a few link chips, not a list.
const MAX_COLLECTION_LINKS = 6

const COLLECTION_QUERY = `query ($id: String!) {
  Asset(where: { id: { _eq: $id } }) {
    description
    icons(order_by: { width: desc }) { src url }
    backgroundImages(order_by: { width: desc }) { src url }
    images(order_by: { width: desc }) { src url }
    links { title url }
  }
}`

/**
 * The collection-level counterpart of fetchLuksoTokenMetadata: the identity the whole
 * collection shares — description, icon, banner and links — for when the contract's
 * LSP4Metadata document is gone but the indexer scraped it while it was alive (Unio Arcani
 * Praesidii Aeterna's document went away with its artwork; its icon and banner are still
 * pinned, and only the indexer remembers which CIDs they are).
 *
 * Same last-resort rule as the token form: reached only after the onchain document failed,
 * never ahead of it. Name, symbol, creators and supply are not read here — those are
 * contract storage and already came back with the onchain reads.
 *
 * @param {{ collection: string }} params Collection address.
 * @returns {Promise<{ description, banner, icon, links, source } | null>} null when the
 * collection isn't indexed, has nothing worth showing, or the request fails or times out.
 */
export const fetchLuksoCollectionMetadata = async ({ collection }) => {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: COLLECTION_QUERY, variables: { id: collection.toLowerCase() } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) return null

  const asset = (await res.json())?.data?.Asset?.[0]
  if (!asset) return null

  const icon = pickUrl(asset.icons?.[0])
  // Same precedence the onchain resolver gives the document: a declared background image,
  // else the first artwork — and, as there, never the icon's own file in a second role.
  // chillwhales' row arrived with the logo as both, and the featured slide stretched it.
  const banner = [pickUrl(asset.backgroundImages?.[0]), pickUrl(asset.images?.[0])].find((candidate) => candidate && !isSameStoredImage(candidate, icon)) || null
  const description = typeof asset.description === 'string' && asset.description.trim() ? asset.description.trim() : null
  const links = (asset.links || [])
    .filter((link) => link && typeof link.url === 'string' && /^https?:\/\//i.test(link.url.trim()))
    .slice(0, MAX_COLLECTION_LINKS)
    .map((link) => ({ title: String(link.title || '').trim() || null, url: link.url.trim() }))

  if (!icon && !banner && !description) return null

  return { description, banner, icon, links, source: 'indexer' }
}

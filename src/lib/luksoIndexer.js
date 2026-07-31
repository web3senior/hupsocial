/**
 * LUKSO Envio indexer (the backend Universal Everything reads from) — pre-resolved
 * LSP8 token metadata with CDN-hosted, browser-cacheable image URLs. Fetching here
 * replaces a multi-hundred-KB getDataForTokenId eth_call for fully onchain
 * collections (Burnt Pix ships its whole SVG inline) with a ~200ms indexed lookup.
 * Mainnet only — the app's other chains resolve over RPC as before.
 */

const LUKSO_MAINNET_ID = 42
const ENDPOINT = 'https://envio.lukso-mainnet.universal.tech/v1/graphql'

// The indexer must never be slower than the RPC path it replaces — give up early
// and let useNftMetadata fall through to the onchain read
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
 * Resolves LSP8 token metadata from the indexer, in useNftMetadata's normalized shape.
 * Returns null when the token isn't indexed (or the request fails/times out) so the
 * caller can fall back to the RPC path.
 * @param {{ collection: string, tokenId: string }} params Collection address and bytes32 token id.
 * @returns {Promise<{ name, collectionName, description, image, attributes, source } | null>}
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
  // Fully onchain collections often index without a hosted image yet — a hit with no
  // image would render worse than the RPC path, so treat it as a miss
  if (!image) return null

  const attributes = (token.attributes || [])
    .filter((attr) => attr?.key && attr.value !== null && attr.value !== undefined && `${attr.value}`.trim() !== '')
    .map((attr) => ({ label: String(attr.key), value: String(attr.value) }))

  return {
    name: token.name || token.lsp4TokenName || collectionName,
    collectionName,
    description: token.description || null,
    image,
    attributes,
    source: 'token',
  }
}

/**
 * @file lib/nftLinks.js
 * @description The one place that turns an indexed offer or listing payload into a link into the
 * app. Notifications, the activity feed and the email/push digests all name the same asset out of
 * the same `data` shape, and every one of them used to dead-end: an offer told you someone bid on
 * your NFT and then gave you nowhere to go and look at it.
 *
 * Token ids are the whole subtlety here. HupOffers keys every asset by bytes32 whatever its
 * standard, so that is what cidex stores — but the token page reads an id's own shape as its
 * standard (bytes32 is LSP8, a decimal is ERC721/ERC1155), because the tiles that link there
 * often don't know which they are holding. An offer's stored id therefore has to be converted
 * back before it can go in a URL, or an ERC721 bid opens a page that picks the LSP8 ABI.
 */

// IHupOffers.AssetStandard — mirrors cidex's OFFER_STANDARD_* constants.
export const OFFER_STANDARD = { ERC721: 0, LSP8: 1, ERC1155: 2, LSP7: 3, ERC20: 4, NATIVE: 5 }

// The standards that name an NFT and so have a token page. The rest are token amounts, which
// HupOffers treats as offers too — those are the P2P/OTC deals.
export const NFT_STANDARDS = [OFFER_STANDARD.ERC721, OFFER_STANDARD.LSP8, OFFER_STANDARD.ERC1155]

/** The DOM id OfferList gives a row, and the hash a link uses to arrive at it. */
export const offerAnchorId = (offerId) => `offer-${offerId}`

/**
 * A token id in the form the token page expects: bytes32 for LSP8, a plain decimal for the
 * ERC standards, whichever form it arrives in.
 * @param {string|number|bigint} tokenId Stored id (bytes32 hex or decimal).
 * @param {boolean} isLsp8 True for LSP8 collections.
 * @returns {string|null} Null when the id is unreadable.
 */
export function tokenIdForUrl(tokenId, isLsp8) {
  const value = String(tokenId ?? '')
  if (!value) return null
  if (isLsp8) return value

  if (!value.startsWith('0x')) return value
  try {
    return BigInt(value).toString()
  } catch {
    return null
  }
}

/**
 * An NFT's own page.
 * @param {Object} params
 * @param {number|string} params.networkId Chain the collection lives on.
 * @param {string} params.collection Collection contract address.
 * @param {string} params.tokenId Token id in its stored form.
 * @param {boolean} params.isLsp8 True for LSP8 collections.
 * @returns {string|null} Null when the payload can't name a token.
 */
export function tokenPageHref({ networkId, collection, tokenId, isLsp8 }) {
  const id = tokenIdForUrl(tokenId, isLsp8)
  if (!networkId || !collection || id === null) return null

  return `/nfts/${networkId}/collection/${String(collection).toLowerCase()}/${encodeURIComponent(id)}`
}

/**
 * Where a notification or activity row about an offer should land: the asset's own page, with
 * the offer's row anchored so the reader arrives at the exact bid rather than at a list to
 * search through.
 * @param {Object|null} data The notification's stored `data` payload, or an activity row's meta.
 * @returns {string|null} Null when the payload names no asset.
 */
export function offerHref(data) {
  if (!data) return null

  const networkId = data.network_id
  const standard = Number(data.standard)
  if (!networkId || !Number.isFinite(standard)) return null

  // Fungible offers are OTC deals — they have no token page, and the P2P directory is the
  // surface that fills them.
  if (!NFT_STANDARDS.includes(standard)) return '/p2p'

  const path = tokenPageHref({
    networkId,
    collection: data.collection,
    tokenId: data.token_id,
    isLsp8: standard === OFFER_STANDARD.LSP8,
  })
  if (!path) return null

  return data.offer_id ? `${path}#${offerAnchorId(data.offer_id)}` : path
}

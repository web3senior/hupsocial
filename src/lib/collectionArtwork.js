/**
 * @file lib/collectionArtwork.js
 * @description What a collection looks like, decided in one place.
 *
 * Every market surface answers the same question — which image stands for this collection —
 * from the same row shape: `icon_uri`/`banner_uri` as nft_collection_cache holds them, and
 * `samples`, the handful of listed token ids the API attaches for collections that ship no
 * artwork of their own. Pure derivation, no fetching: the row already carries everything.
 */

import { isSameStoredImage } from '@/lib/storageHelper'

// How many listings a cover mosaic draws from. Three is what the layout takes — one lead
// tile beside two stacked — and asking for more only widens the API's sample query.
export const COLLECTION_SAMPLE_LIMIT = 3

/**
 * The collection's own icon, whichever shape the row carries it in — the ranking and rail
 * ship the cached column, useCollectionInfo hands back the resolved field.
 * @param {Object} row A collection row.
 * @returns {string|null} The stored URI, unresolved.
 */
export const collectionIconUri = (row) => row?.icon_uri || row?.icon || null

/**
 * The collection's banner, or null when it is really the icon again.
 *
 * A banner that is the icon's own file is no banner: a square logo stretched 2.6:1 is worse
 * than the icon shown in a slot drawn for it. The resolvers no longer cache such a banner,
 * but rows written before they learned that live out their TTL.
 * @param {Object} row A collection row.
 * @returns {string|null} The stored URI, unresolved.
 */
export const collectionBannerUri = (row) => {
  const banner = row?.banner_uri || row?.banner || null
  if (!banner) return null
  const icon = collectionIconUri(row)
  return icon && isSameStoredImage(banner, icon) ? null : banner
}

/**
 * The tokens a cover falls back to when the collection has no artwork of its own, in the
 * API's order (most recently listed first).
 * @param {Object} row A collection row, as the collections or ranking API returns it.
 * @returns {Array<{tokenId: string, isLsp8: boolean}>} At most COLLECTION_SAMPLE_LIMIT.
 */
export const collectionSamples = (row) =>
  (row?.samples || [])
    .slice(0, COLLECTION_SAMPLE_LIMIT)
    .map((sample) => ({ tokenId: sample.token_id ?? sample.tokenId, isLsp8: Boolean(Number(sample.is_lsp8 ?? sample.isLsp8)) }))
    .filter((sample) => sample.tokenId !== null && sample.tokenId !== undefined && sample.tokenId !== '')

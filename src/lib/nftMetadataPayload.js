/**
 * @file lib/nftMetadataPayload.js
 * @description Shapes resolved metadata into the payload the client receives. Shared by the
 * single, batch, and refresh endpoints so all three describe a token identically.
 *
 * Its one real job is keeping inline artwork out of the response: a fully onchain collection
 * returns hundreds of KB of base64 that the browser could never cache, so the payload carries
 * a /api/nft/image reference instead.
 */

import { createHash } from 'node:crypto'
import { isInlineDataUri } from '@/lib/nftMetadata'

export const toMetadataPayload = ({ metadata, chainId, collection, tokenId, isLsp8 }) => {
  const inline = isInlineDataUri(metadata.image)

  // The consumer appends its own w/q/still hints to this path.
  const imageProxyParams = new URLSearchParams({ chainId: String(Number(chainId)), collection: collection.toLowerCase(), tokenId: String(tokenId) })
  if (isLsp8) imageProxyParams.set('isLsp8', '1')

  // The proxy path is keyed on the token, not on its artwork, so it would stay identical
  // after a collection changed its onchain art — browsers and CDNs would keep serving the
  // old picture for up to a day even once the cache row had updated. A fingerprint of the
  // resolved artwork makes new art a genuinely new URL. The proxy ignores this parameter.
  if (inline) imageProxyParams.set('v', createHash('sha1').update(metadata.image).digest('hex').slice(0, 8))

  return {
    name: metadata.name,
    collectionName: metadata.collectionName,
    description: metadata.description,
    image: inline ? `/api/nft/image?${imageProxyParams.toString()}` : metadata.image,
    // Lets the client know the URL is already a sized proxy endpoint rather than a
    // storage reference it still has to route.
    imageIsProxied: inline,
    // {url, fileType} for the collection's 3D file, or null. Unlike the artwork this is
    // never proxied: a mesh has to reach the renderer byte-for-byte, and the image proxy
    // would try to make a WebP out of it.
    model: metadata.model || null,
    attributes: metadata.attributes,
    source: metadata.source,
  }
}

/**
 * Utility helper to handle decentralized and custom asset routing.
 */

/**
 * Checks if a given string is a 0G Storage root hash or protocol.
 * @param {string} src - The asset path or hash string.
 * @returns {boolean}
 */
export const is0GHash = (src) => {
  return typeof src === 'string' && (src.startsWith('0x') || src.startsWith('0g://'))
}

/**
 * Resolves a 0G root hash to a direct backend streaming proxy endpoint.
 * @param {string} hash - The 0G root hash or protocol URI.
 * @returns {string|null} The API proxy endpoint URL, or null if invalid.
 */
export const resolve0GUrl = (hash) => {
  if (!hash || !is0GHash(hash)) return null

  /* Strip protocol if it was passed as 0g:// instead of raw hex */
  const cleanHash = hash.replace(/^0g:\/\//, '')

  /* Point directly to the API endpoint to leverage native browser streaming and caching */
  return `/api/0g/file?hash=${cleanHash}`
}

/**
 * Checks if a given string is an IPFS protocol URI.
 * @param {string} src - The asset path or hash string.
 * @returns {boolean}
 */
export const isIPFSHash = (src) => {
  return typeof src === 'string' && src.startsWith('ipfs://')
}

/**
 * Resolves an IPFS URL to a gateway endpoint.
 * @param {string} ipfsUrl - The IPFS URL containing the hash.
 * @returns {string|null} The gateway endpoint URL, or null if invalid.
 */
export const resolveIPFSUrl = (ipfsUrl) => {
  if (!ipfsUrl || !isIPFSHash(ipfsUrl)) return null

  /* Strip the protocol prefix to isolate the hash */
  const hash = ipfsUrl.replace(/^ipfs:\/\//, '')

  /* Point directly to the configured IPFS Gateway */
  return `${process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL}${hash}`
}

/**
 * Resolves an IPFS image to the server-side compression proxy (sharp → WebP).
 * Only use for images — video/audio should resolve via resolveIPFSUrl to keep
 * native gateway streaming.
 * @param {string} ipfsUrl - The IPFS URL or raw CID.
 * @param {{ width?: number, quality?: number, still?: boolean, format?: 'webp'|'jpeg' }} [options] - Optional
 * resize width, quality (1-100), still (first-frame-only, skips animated encoding — for thumbnails), and
 * format ('jpeg' for social crawlers that mishandle WebP; defaults to WebP).
 * @returns {string|null} The API proxy endpoint URL, or null if invalid.
 */
export const resolveIPFSImageUrl = (ipfsUrl, options = {}) => {
  if (!ipfsUrl || typeof ipfsUrl !== 'string') return null

  /* Accept both ipfs:// URIs and raw CIDs */
  const hash = ipfsUrl.replace(/^ipfs:\/\//, '')
  if (!hash) return null

  const params = new URLSearchParams({ cid: hash })
  if (options.width) params.set('w', String(options.width))
  if (options.quality) params.set('q', String(options.quality))
  if (options.still) params.set('still', '1')
  if (options.format === 'jpeg') params.set('fmt', 'jpeg')

  return `/api/ipfs/file?${params.toString()}`
}

const UP_CLOUD_IMAGE_PREFIX = 'https://api.universalprofile.cloud/image/'

/**
 * Checks if a given string matches your custom protocol.
 * @param {string} src - The asset path or URI string.
 * @returns {boolean}
 */
export const isCustomProtocol = (src) => {
  return typeof src === 'string' && src.startsWith('custom://')
}

/**
 * Resolves a custom protocol URI to its target endpoint.
 * @param {string} customUrl - The custom:// protocol URI.
 * @returns {string|null} The resolved URL path, or null if invalid.
 */
export const resolveCustomUrl = (customUrl) => {
  if (!customUrl || !isCustomProtocol(customUrl)) return null

  /* Strip the protocol prefix to isolate the reference/ID */
  const cleanPath = customUrl.replace(/^custom:\/\//, '')

  /* Swap this return with whatever endpoint pattern your custom protocol uses */
  return `/api/custom/assets?path=${cleanPath}`
}

/**
 * Universal resolver that automatically detects the asset storage type and resolves it.
 * @param {string} src - The raw input string (IPFS CID, 0G Hash, Custom URI, or HTTP URL).
 * @returns {string|null} The fully resolved target URL string.
 */
export const resolveStorageUrl = (src) => {
  if (!src || typeof src !== 'string') return null

  /* Route IPFS Protocol */
  if (isIPFSHash(src)) {
    return resolveIPFSUrl(src)
  }

  /* Route 0G Storage Protocol */
  if (is0GHash(src)) {
    return resolve0GUrl(src)
  }

  /* Route Custom Protocol */
  if (isCustomProtocol(src)) {
    return resolveCustomUrl(src)
  }

  /* Fallback: If it's already a regular web URL (http://, https://) or absolute asset path, return it as-is */
  return src
}

/**
 * Universal resolver for IMAGE assets — routes decentralized storage through the
 * server-side sharp compression proxies (WebP output, optional resize).
 * Only use for images; video/audio must resolve via resolveStorageUrl to keep
 * native gateway streaming.
 * @param {string} src - The raw input string (IPFS CID, 0G Hash, Custom URI, or HTTP URL).
 * @param {{ width?: number, quality?: number, still?: boolean, format?: 'webp'|'jpeg' }} [options] - Optional
 * resize width, quality (1-100), still (first-frame-only, skips animated encoding — for thumbnails), and
 * format ('jpeg' for social crawlers that mishandle WebP; defaults to WebP).
 * @returns {string|null} The fully resolved target URL string.
 */
export const resolveStorageImageUrl = (src, options = {}) => {
  if (!src || typeof src !== 'string') return null

  /* Route IPFS images through the compression proxy */
  if (isIPFSHash(src)) {
    return resolveIPFSImageUrl(src, options)
  }

  /* 0G images already stream through /api/0g/file — append resize/quality params */
  if (is0GHash(src)) {
    const base = resolve0GUrl(src)
    if (!base) return null
    const params = []
    if (options.width) params.push(`w=${options.width}`)
    if (options.quality) params.push(`q=${options.quality}`)
    if (options.still) params.push('still=1')
    if (options.format === 'jpeg') params.push('fmt=jpeg')
    return params.length ? `${base}&${params.join('&')}` : base
  }

  /* LUKSO's UP-cloud image CDN ignores ?width= — it serves the full original either way,
     so a 26px avatar can pull megabytes (animated GIF profile pictures are the worst case)
     and often hasn't decoded by the time the surface is on screen. The path after /image/
     is the IPFS CID, optionally with a subpath, and NEXT_PUBLIC_IPFS_GATEWAY_URL is that
     same host — so hand it to the sharp proxy, which does honour a width. */
  if (src.startsWith(UP_CLOUD_IMAGE_PREFIX) && options.width) {
    const cid = src.slice(UP_CLOUD_IMAGE_PREFIX.length).split('?')[0]
    if (cid) return resolveIPFSImageUrl(cid, options)
  }

  /* Everything else (custom protocol, http, asset paths) resolves as before */
  return resolveStorageUrl(src)
}

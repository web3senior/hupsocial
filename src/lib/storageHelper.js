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

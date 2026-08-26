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

/* Video and audio stream straight from a gateway, and the browser drives that with HTTP range
   requests: the first frame needs only the head of the file, a loop or a seek needs a slice from
   the middle. The configured gateway advertises `Accept-Ranges: bytes` and then answers every
   range with the whole file (a 64 KB probe of a 3.6 MB clip downloaded all 3.6 MB), so playback
   waited on the full download and every loop fetched it again. Filebase — where uploads pin —
   honours ranges, so it streams first; the configured gateways follow as <source> fallbacks. */
const STREAM_GATEWAY_URL = process.env.NEXT_PUBLIC_IPFS_STREAM_GATEWAY_URL || 'https://ipfs.filebase.io/ipfs/'

/**
 * Resolves an IPFS video/audio CID to gateway URLs in the order a player should try them.
 * @param {string} ipfsUrl - The IPFS URL containing the hash.
 * @returns {string[]} Gateway URLs, range-capable first; empty when the input is not IPFS.
 */
export const resolveIPFSStreamUrls = (ipfsUrl) => {
  if (!ipfsUrl || !isIPFSHash(ipfsUrl)) return []

  const hash = ipfsUrl.replace(/^ipfs:\/\//, '')
  const gateways = [STREAM_GATEWAY_URL, process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL, process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL_FALLBACK]
    .filter(Boolean)
    /* The fallback var has shipped as http:// — every gateway speaks https, and a mixed scheme
       would only list the same host twice */
    .map((gateway) => gateway.replace(/^http:\/\//, 'https://'))
    .map((gateway) => (gateway.endsWith('/') ? gateway : `${gateway}/`))

  return [...new Set(gateways)].map((gateway) => `${gateway}${hash}`)
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

/* What the LUKSO indexer hands back as a profile image `src` — and so what
   fulfillUniversalProfiles writes to users.profileImage. Every UP row carries this shape; the
   `ipfs://` twin lives on the indexer's `url` field, which we don't store. Matching it is how a
   stored reference gets back to a bare CID. */
const UP_CLOUD_IMAGE_PREFIX = 'https://api.universalprofile.cloud/image/'

/* Our own proxy endpoint — which is a shape we RECEIVE as well as one we emit. The profile API
   resolves `profileImage` through resolveStorageImageUrl before serving it, so what reaches a
   component is usually already a proxy URL at that route's chosen width rather than the stored
   reference. Reading the CID back out of one is what lets a 26px slot re-resolve at 26px
   instead of inheriting a 512, and what keeps a direct-gateway retry possible at all. */
const PROXY_IMAGE_PATH = '/api/ipfs/file'

/**
 * Pulls the bare IPFS CID out of every reference shape that reaches us — an `ipfs://` URI, a
 * LUKSO `/image/` CDN URL whose `?method=…&data=…` verification params are no part of the CID,
 * or one of our own already-resolved proxy URLs.
 * @param {string} src - The stored or already-resolved image reference.
 * @returns {string|null} The CID (with any subpath), or null when the shape carries none.
 */
export const extractIPFSCid = (src) => {
  if (!src || typeof src !== 'string') return null
  if (isIPFSHash(src)) return src.replace(/^ipfs:\/\//, '') || null
  if (src.startsWith(UP_CLOUD_IMAGE_PREFIX)) return src.slice(UP_CLOUD_IMAGE_PREFIX.length).split('?')[0] || null

  /* Matched by path rather than by full URL so it reads both the relative form the resolver
     emits and the absolute one a serialized payload may carry. URLSearchParams also undoes the
     encoding, which matters for the CIDs that carry a `/0-profile…` subpath. */
  const proxyAt = src.indexOf(`${PROXY_IMAGE_PATH}?`)
  if (proxyAt !== -1) return new URLSearchParams(src.slice(proxyAt + PROXY_IMAGE_PATH.length + 1)).get('cid') || null

  return null
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

/**
 * Universal resolver for STREAMED assets (video/audio) — the same routing as resolveStorageUrl,
 * except IPFS content comes back as an ordered list of gateways for a player's <source> chain.
 * @param {string} src - The raw input string (IPFS CID, 0G Hash, Custom URI, or HTTP URL).
 * @returns {string[]} URLs to try in order; empty when the input can't be resolved.
 */
export const resolveStorageStreamUrls = (src) => {
  if (isIPFSHash(src)) return resolveIPFSStreamUrls(src)
  const url = resolveStorageUrl(src)
  return url ? [url] : []
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

  /* Two shapes land here carrying a CID that is not an `ipfs://` URI, and both need the width
     applied rather than ignored:

     LUKSO's UP-cloud image CDN won't resize — ?width= comes back 404 and the bare path serves
     the full original, so a 26px avatar can pull megabytes (animated GIF profile pictures are
     the worst case) and often hasn't decoded by the time the surface is on screen.

     Our own proxy URLs arrive already resolved at whichever width the producing route picked —
     512 from the profile API — which is just as wrong for a 26px slot, and silently so, since
     the URL looks correct.

     Either way the answer is the same: recover the CID and re-resolve it through the sharp
     proxy at the width the caller actually needs. */
  if (options.width) {
    const cid = extractIPFSCid(src)
    if (cid) return resolveIPFSImageUrl(cid, options)
  }

  /* Everything else (custom protocol, http, asset paths) resolves as before */
  return resolveStorageUrl(src)
}

/**
 * Resolves an image reference straight to the configured IPFS gateway, bypassing the sharp
 * proxy. This is the fallback for when the proxy's raced gateways don't hold a CID that the
 * gateway itself does — prefer resolveStorageImageUrl, which resizes; this returns the original
 * at full size. Built from the CID rather than reusing a stored CDN URL: the LUKSO `/image/`
 * route serves a re-encoded file about twice the size once its `?method=…&data=…` params are
 * missing, and the gateway host is ours to configure.
 * @param {string} src - The raw input string (IPFS CID, `ipfs://` URI, UP-cloud URL, or HTTP URL).
 * @returns {string|null} A direct gateway URL, or the plainly-resolved URL for non-IPFS shapes.
 */
export const resolveStorageGatewayUrl = (src) => {
  const cid = extractIPFSCid(src)
  if (cid) return `${process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL}${cid}`

  return resolveStorageUrl(src)
}

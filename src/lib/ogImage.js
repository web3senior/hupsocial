/**
 * @file lib/ogImage.js
 * @description Getting pictures into a satori-rendered share card.
 *
 * Every OG route hits the same three problems, so they are solved once here rather than per card.
 * Satori will fetch a remote `src` itself, but it has no decoder for WebP or animated GIF and no
 * timeout, so a stalled gateway would hang a render a crawler is already waiting on. The storage
 * helpers emit app-relative proxy paths, which `fetch` cannot use without an origin. And the
 * chain logos are inline SVG carrying gradients and referenced clipPaths that satori draws
 * wrongly where it draws them at all.
 *
 * All three answers are the same shape: decode to a PNG data URI here, on a clock, and return
 * null on any failure — a card missing one picture still reads, a card that never arrives does not.
 */

import sharp from 'sharp'
import { extractIPFSCid, resolveIPFSImageUrl, resolveStorageImageUrl } from '@/lib/storageHelper'

/* Artwork past this is a broken or hostile source, not something worth decoding into a card */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024

/**
 * Makes a resolved reference reachable from the server: the storage helpers emit app-relative
 * proxy paths, and fetch needs an origin in front of them.
 * @param {string|null} resolved Output of one of the storageHelper resolvers.
 * @param {string} baseUrl Origin of this deployment.
 * @returns {string|null}
 */
export const toFetchable = (resolved, baseUrl) => {
  if (!resolved) return null
  return resolved.startsWith('/') ? `${baseUrl}${resolved}` : resolved
}

/**
 * Resolves a piece of artwork to a fetchable URL, through the proxy wherever it carries a CID.
 *
 * resolveStorageImageUrl only re-routes a UP-cloud or already-proxied URL when a width is given;
 * extracting the CID first means every shape that carries one goes through the proxy, width or
 * not. The plain (no-width) object is the one the app itself requests, so it is the one most
 * likely to be sitting warm on the CDN.
 *
 * @param {string} uri ipfs:// URI, bare CID, UP-cloud URL, data: URI or absolute URL.
 * @param {string} baseUrl Origin used to absolutize the app-relative storage proxies.
 * @param {{ width?: number, still?: boolean }} [options] Proxy resize hints.
 * @returns {string|null}
 */
export const resolveArtworkUrl = (uri, baseUrl, options = {}) => {
  if (!uri || typeof uri !== 'string') return null
  if (uri.startsWith('data:')) return uri

  /* Some rows carry a bare CID where the schema expects an ipfs:// URI */
  const normalized = /^(Qm|baf)/.test(uri) ? `ipfs://${uri}` : uri

  const cid = extractIPFSCid(normalized)
  const resolved = cid ? resolveIPFSImageUrl(cid, options) : resolveStorageImageUrl(normalized, options)
  return toFetchable(resolved, baseUrl)
}

/**
 * Fetches an image and re-encodes it as a PNG data URI.
 *
 * @param {string|null} url
 * @param {number} boxSize Longest edge to fit within, in pixels.
 * @param {number} timeoutMs How long this picture is worth waiting for.
 * @param {Object} [options]
 * @param {string|null} [options.background] Composite onto this colour. PNG has alpha and satori
 *   composites it onto the card, so a transparent logo would otherwise vanish into a dark card —
 *   pass the card's own background. Null keeps the alpha, for a shape rather than a picture.
 * @returns {Promise<string|null>}
 */
export const toPngDataUri = async (url, boxSize, timeoutMs, { background = null } = {}) => {
  if (!url) return null

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) return null

    const arrayBuffer = await response.arrayBuffer()
    if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) return null

    let pipeline = sharp(Buffer.from(arrayBuffer), { animated: false, autoOrient: true })
      /* `inside` bounds the pixel count without changing the aspect ratio. Cropping here as well
         as in the layout would crop twice — a wide photo squared off by sharp and then cropped
         again by objectFit keeps only the middle of the middle. */
      .resize({ width: boxSize, height: boxSize, fit: 'inside', withoutEnlargement: true })

    if (background) pipeline = pipeline.flatten({ background })

    const png = await pipeline.png().toBuffer()
    return `data:image/png;base64,${png.toString('base64')}`
  } catch {
    /* A card without artwork still reads; one that never arrives does not */
    return null
  }
}

/**
 * Rasterizes an inline SVG logo into a PNG data URI at the size it will be laid out.
 *
 * Rendering at 4x the slot before the resize is what keeps a 32px viewBox from arriving soft.
 * Alpha is kept — these are shapes on the card, not pictures in a frame.
 *
 * @param {string|null} svg Raw SVG markup, e.g. from config/chainIcons.
 * @param {number} sizePx Longest edge, in the card's own pixels.
 * @returns {Promise<string|null>}
 */
export const svgToPngDataUri = async (svg, sizePx) => {
  if (!svg) return null

  try {
    const png = await sharp(Buffer.from(svg), { density: 72 * 4 })
      .resize({ width: sizePx, height: sizePx, fit: 'inside' })
      .png()
      .toBuffer()

    return `data:image/png;base64,${png.toString('base64')}`
  } catch (error) {
    console.warn('[og] svg logo render failed:', error.message)
    return null
  }
}

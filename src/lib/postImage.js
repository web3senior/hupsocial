/**
 * @file lib/postImage.js
 * @description Post → a picture of the post, for "Copy as image" in the share menu.
 *
 * The picture is the card the reader is looking at: the post's own element, cloned into the
 * copy dialog (lib/postCaptureSheet.js) and rasterized from there through an SVG
 * <foreignObject> with its computed styles, webfonts and pictures inlined. Same theme, same
 * avatar, same media, same counters — a copy of the post rather than a second rendering of it,
 * which is the only way the two can never drift apart.
 *
 * The link-preview card (`/networks/{networkId}/{postId}/opengraph-image`) stays as the
 * fallback for the surfaces that share a post without drawing one — the Shorts player is a
 * full-screen video, not a card — where there is nothing to clone.
 *
 * Lives in a module rather than in a component because a copy has to outlive the dialog that
 * starts it: the sheet closes on the click and a toast carries the verdict.
 */

import { getPostPermalink } from './postMarkdown'

/* What the clipboard takes, and what every route to a picture here produces */
const IMAGE_TYPE = 'image/png'

/* Retina. The card is ~600px wide, so this is the difference between a copy that survives being
   dropped into a full-width post elsewhere and one that arrives soft. */
const CAPTURE_SCALE = 2

/* An object URL revoked in the same task as the click loses the download in Firefox */
const REVOKE_DELAY_MS = 1000

/* Every picture on the card is fetched again to be inlined into the SVG, and a post's media
   comes from IPFS — one gateway having a bad minute must cost that picture, not the copy. The
   rasterizer's own default is 30s per asset, which is longer than anyone waits for a clipboard. */
const ASSET_TIMEOUT_MS = 8000

/** How a copy ended: on the clipboard, or saved to disk because the clipboard refused it. */
export const COPIED = 'copied'
export const SAVED = 'saved'

/**
 * URL of a post's link-preview card — the fallback picture.
 * @param {Object} item Post row.
 * @param {string} [origin] Absolute origin; omit for a relative path.
 */
export function getPostImageUrl(item, origin = '') {
  return `${getPostPermalink(item, origin)}/opengraph-image`
}

/**
 * Whether this subject can be copied as a picture at all. The share menu is also opened by pages
 * that share a URL rather than a post row (an NFT, a prediction market) — those have neither a
 * card on screen nor a preview route.
 * @param {Object} [item] Post row, when the subject is a post.
 */
export function hasPostImage(item) {
  return item?.network_id != null && item?.id != null
}

/**
 * Whether the browser can take a picture on the clipboard.
 *
 * Three separate gaps hide behind one API: the whole Clipboard API is absent outside a secure
 * context (a dev server reached over plain http on the LAN), `ClipboardItem` exists in older
 * Firefox with only text support, and `supports()` is itself recent enough to be missing where
 * images do work. Whatever this misses lands on the download path, which needs none of it.
 */
export function supportsImageClipboard() {
  if (typeof window === 'undefined') return false
  if (typeof window.ClipboardItem !== 'function') return false
  if (typeof navigator?.clipboard?.write !== 'function') return false
  if (typeof window.ClipboardItem.supports === 'function') return window.ClipboardItem.supports(IMAGE_TYPE)
  return true
}

/** Filename a saved picture lands under. Post ids repeat across chains, so the network is part of it. */
export function getPostImageFilename(item) {
  return `hup-post-${item?.network_id}-${item?.id}.png`
}

/**
 * Rasterizes an element exactly as it stands — the copy dialog's sheet, with the cloned card on
 * it.
 *
 * The rasterizer is imported on the gesture rather than with the module: it is 55KB that every
 * feed would otherwise carry for a menu entry most readers never open.
 *
 * @param {HTMLElement} element
 * @returns {Promise<Blob>} A PNG of the element.
 */
export async function captureElement(element) {
  const { domToBlob } = await import('modern-screenshot')

  const blob = await domToBlob(element, {
    type: IMAGE_TYPE,
    scale: CAPTURE_SCALE,
    /* The layout size, stated outright: the preview is scaled down to fit the dialog with a
       transform, and the rasterizer measures the painted box — left to itself it would bake the
       preview's own shrink into the picture. */
    width: element.offsetWidth,
    height: element.offsetHeight,
    /* The sheet paints its own background, in whichever colour the reader picked */
    backgroundColor: null,
    timeout: ASSET_TIMEOUT_MS,
    /* Every face is fetched and base64'd into the SVG, and the app's faces ship in more than one
       format — without this the copy carries the same fonts several times over. */
    font: { preferredFormat: 'woff2' },
  })

  if (!blob) throw new Error('The card could not be rasterized')
  return blob.type === IMAGE_TYPE ? blob : new Blob([blob], { type: IMAGE_TYPE })
}

/**
 * The link-preview card as a blob the clipboard will accept.
 *
 * The clipboard matches a blob's own type against the key it was filed under, so a response that
 * answers `image/png; charset=utf-8` — or an error page answering HTML behind a 200 — has to be
 * caught here rather than by a write that fails with nothing to say.
 * @param {string} url
 * @returns {Promise<Blob>}
 */
async function fetchPostImageBlob(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`The post card could not be rendered (${response.status})`)

  const blob = await response.blob()
  if (!blob.type.startsWith(IMAGE_TYPE)) throw new Error(`The post card came back as ${blob.type || 'nothing'}`)

  return blob.type === IMAGE_TYPE ? blob : new Blob([blob], { type: IMAGE_TYPE })
}

/**
 * Hands a picture to the browser's downloader — what the dialog's save button does, and the
 * fallback for every browser that has no image clipboard or refuses the write.
 * @param {Blob} blob
 * @param {string} filename
 * @returns {string} SAVED
 */
function savePicture(blob, filename) {
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = href
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(href), REVOKE_DELAY_MS)

  return SAVED
}

/**
 * Puts a picture on the clipboard, or saves it when the clipboard will not take one.
 *
 * Must be called straight out of the click, before anything is awaited: Safari drops the user
 * activation across an await, so the `ClipboardItem` is handed the picture as a promise and the
 * write starts in the same task as the gesture that asked for it.
 *
 * @param {Promise<Blob>} pending The picture, already being drawn.
 * @param {string} filename Name it lands under if it has to be saved instead.
 * @returns {Promise<string>} COPIED or SAVED.
 */
function copyPicture(pending, filename) {
  if (!supportsImageClipboard()) return pending.then((blob) => savePicture(blob, filename))

  // The write swallows a rejected picture into its own failure, so the outcome is mirrored here
  // — that is what tells a clipboard the browser refused apart from a picture that was never
  // drawn, and it settles the rejection rather than leaving it unhandled.
  const settled = pending.then((blob) => ({ blob }), (error) => ({ error }))

  return navigator.clipboard
    .write([new window.ClipboardItem({ [IMAGE_TYPE]: pending })])
    .then(() => COPIED)
    .catch(async () => {
      const { blob, error } = await settled
      if (error) throw error

      // The picture is in hand and only the clipboard said no — a download is still the thing
      // the user asked for.
      return savePicture(blob, filename)
    })
}

/**
 * Copies the sheet the reader has been looking at.
 * @param {HTMLElement} element The copy dialog's sheet.
 * @param {Object} item Post row, for the filename.
 * @returns {Promise<string>} COPIED or SAVED.
 */
export function copySheetImage(element, item) {
  return copyPicture(captureElement(element), getPostImageFilename(item))
}

/**
 * Saves the sheet the reader has been looking at.
 * @param {HTMLElement} element The copy dialog's sheet.
 * @param {Object} item Post row, for the filename.
 * @returns {Promise<string>} SAVED.
 */
export function saveSheetImage(element, item) {
  return captureElement(element).then((blob) => savePicture(blob, getPostImageFilename(item)))
}

/**
 * Copies a post that has no card on screen to clone — the Shorts player shares a full-screen
 * video — as the picture its every link preview already shows.
 *
 * @param {Object} item Post row.
 * @param {Object} [options]
 * @param {string} [options.origin] Absolute origin of this deployment.
 * @returns {Promise<string>} COPIED or SAVED.
 */
export function copyPostImage(item, { origin = window.location.origin } = {}) {
  return copyPicture(fetchPostImageBlob(getPostImageUrl(item, origin)), getPostImageFilename(item))
}

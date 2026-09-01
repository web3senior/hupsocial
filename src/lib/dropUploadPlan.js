/**
 * @file lib/dropUploadPlan.js
 * @description Turns a validated zip into an ordered plan of pin requests, and folds the results
 * back into the base URI a collection needs.
 *
 * Two pins, not one, and in this order: the artwork must be pinned before any metadata can be
 * written, because each token's JSON has to carry the URL of its own image. That ordering is the
 * whole reason this is a plan rather than a single call.
 *
 * Artwork is pinned in BATCHES because `/api/ipfs/folder` is bounded by the platform's request
 * body cap — comfortably enough for a thousand small JSON files, nowhere near enough for a
 * thousand images. Batching is safe for artwork precisely because it does not need a single
 * directory: every image is addressed by a full URL from inside its token's metadata, so a
 * collection's art can live across several pinned folders without anything downstream noticing.
 * The metadata, by contrast, MUST land as one directory — `baseURI + tokenId` can only resolve
 * inside a single root — which is exactly why it is the half that fits.
 */

import { buildTokenMetadata, hashBytes, metadataFileName } from '@/lib/dropUpload'

/** Bytes per artwork batch. Under the 4.5 MB platform cap with room for multipart overhead. */
export const IMAGE_BATCH_BYTES = 3 * 1024 * 1024

/** Files per artwork batch, whatever their size — the route caps the count as well. */
export const IMAGE_BATCH_FILES = 400

/**
 * Groups artwork into batches that will each fit one request.
 *
 * A single file larger than the batch budget still gets its own batch rather than being dropped:
 * it may well fail at the route, and the honest place to find that out is with a real error about
 * that file, not by silently omitting a token from the collection.
 *
 * @param {Array<{name: string, bytes: Uint8Array, token: number}>} images
 */
export function planImageBatches(images, { maxBytes = IMAGE_BATCH_BYTES, maxFiles = IMAGE_BATCH_FILES } = {}) {
  const batches = []
  let current = []
  let bytes = 0

  for (const image of images) {
    const size = image.bytes.byteLength
    if (current.length && (bytes + size > maxBytes || current.length >= maxFiles)) {
      batches.push(current)
      current = []
      bytes = 0
    }
    current.push(image)
    bytes += size
  }
  if (current.length) batches.push(current)

  return batches
}

/**
 * The filename an image keeps inside its pinned batch. Flattened to `<token>.<ext>` so the URL is
 * derivable from the token number alone — an artist's original names ("HOODLESS #1111 final
 * v2.png") survive pinning badly, and nothing downstream needs them.
 */
export const imageFileName = (image) => {
  const ext = (image.name.split('.').pop() ?? 'png').toLowerCase()
  return `${image.token}.${ext}`
}

/**
 * Everything the metadata pass needs, keyed by token: where the image landed and what its bytes
 * hash to. Built from the batch results as they come back, so a resumed upload can rebuild this
 * from the batches it already finished.
 *
 * @param {Array<{cid: string, images: Array}>} completed
 */
export function indexPinnedImages(completed) {
  const byToken = new Map()
  for (const { cid, images } of completed) {
    for (const image of images) {
      byToken.set(image.token, {
        url: `ipfs://${cid}/${imageFileName(image)}`,
        hash: hashBytes(image.bytes),
      })
    }
  }
  return byToken
}

/**
 * The metadata files to pin as one directory, one per token.
 *
 * Throws rather than skipping when a token has no pinned image: a collection with a hole in it
 * mints a token whose metadata points nowhere, and that is not recoverable after the fact —
 * better to fail here, while the zip is still in front of the creator.
 */
export function buildMetadataFiles({ images, pinnedImages, standardId, collectionName, traits }) {
  return images.map((image) => {
    const pinned = pinnedImages.get(image.token)
    if (!pinned) throw new Error(`Token ${image.token} has no pinned artwork — upload was interrupted, run it again`)

    const metadata = buildTokenMetadata({
      standardId,
      token: image.token,
      imageUrl: pinned.url,
      imageHash: pinned.hash,
      collectionName,
      entry: traits.get(image.token),
    })

    return {
      name: metadataFileName(standardId, image.token),
      content: JSON.stringify(metadata, null, 2),
    }
  })
}

/**
 * Progress as a share of the whole job, weighted by bytes rather than by file count — a thousand
 * 8 KB JSON files are not half the work of a thousand 40 KB images, and a bar that says they are
 * stalls at the halfway mark for the entire second half.
 */
export function uploadProgress({ imageBatches, doneBatches, metadataDone }) {
  const imageBytes = imageBatches.reduce((sum, batch) => sum + batch.reduce((n, i) => n + i.bytes.byteLength, 0), 0)
  const doneBytes = imageBatches.slice(0, doneBatches).reduce((sum, batch) => sum + batch.reduce((n, i) => n + i.bytes.byteLength, 0), 0)

  // The metadata pass is one request against many, so give it a fixed slice rather than pretending
  // to measure it — a tenth is about what it costs in practice.
  const METADATA_SHARE = 0.1
  if (!imageBytes) return metadataDone ? 100 : 0

  const imageShare = (doneBytes / imageBytes) * (1 - METADATA_SHARE) * 100
  return Math.min(100, Math.round(imageShare + (metadataDone ? METADATA_SHARE * 100 : 0)))
}

/**
 * A human estimate of what remains, from bytes actually moved so far. Null until there is enough
 * evidence to be worth showing — a number that swings between "2 minutes" and "40 minutes" on
 * every tick is worse than no number, which is the failure mode of estimating from the first
 * batch alone.
 */
export function estimateRemaining({ bytesDone, bytesTotal, elapsedMs }) {
  if (!bytesDone || !elapsedMs || bytesDone >= bytesTotal) return null
  if (elapsedMs < 3000) return null

  const bytesPerMs = bytesDone / elapsedMs
  if (!bytesPerMs) return null

  const remainingMs = (bytesTotal - bytesDone) / bytesPerMs
  return { remainingMs, bytesPerSecond: bytesPerMs * 1000 }
}

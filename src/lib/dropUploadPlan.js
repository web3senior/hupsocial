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
 * An image too big for even one request on its own goes up as a single file instead, through the
 * presigned path that has no such cap — a full URL is a full URL whether it points into a folder
 * or at a file.
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
 * A single file larger than the batch budget still gets a batch of its own rather than being
 * dropped; `isSoloBatch` picks those out so the caller sends them as one file, not through the
 * folder route that cannot take them.
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
 * A batch the folder route cannot carry: one image already past the batch budget. It goes up on
 * its own through the single-file path, which is presigned past the platform body cap — and
 * loses nothing by it, since its metadata addresses it by a full URL either way.
 */
export const isSoloBatch = (batch, { maxBytes = IMAGE_BATCH_BYTES } = {}) => batch.length === 1 && batch[0].bytes.byteLength > maxBytes

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
 * from the batches it already finished. A solo upload pinned the file itself, so its cid is the
 * whole address; a folder batch addresses each image by name under the directory root.
 *
 * @param {Array<{cid: string, images: Array, solo?: boolean}>} completed
 */
export function indexPinnedImages(completed) {
  const byToken = new Map()
  for (const { cid, images, solo } of completed) {
    for (const image of images) {
      byToken.set(image.token, {
        url: solo ? `ipfs://${cid}` : `ipfs://${cid}/${imageFileName(image)}`,
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
 * stalls at the halfway mark for the entire second half. `bytesInFlight` is what the batch under
 * way has sent so far: a solo file reports as it goes, since it can be the longest single step.
 */
export function uploadProgress({ imageBatches, doneBatches, bytesInFlight = 0, metadataDone }) {
  const imageBytes = imageBatches.reduce((sum, batch) => sum + batch.reduce((n, i) => n + i.bytes.byteLength, 0), 0)
  const doneBytes = imageBatches.slice(0, doneBatches).reduce((sum, batch) => sum + batch.reduce((n, i) => n + i.bytes.byteLength, 0), 0) + bytesInFlight

  // The metadata pass is one request against many, so give it a fixed slice rather than pretending
  // to measure it — a tenth is about what it costs in practice.
  const METADATA_SHARE = 0.1
  if (!imageBytes) return metadataDone ? 100 : 0

  const imageShare = (Math.min(doneBytes, imageBytes) / imageBytes) * (1 - METADATA_SHARE) * 100
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

/** The most tokens a template will generate for. Past this the metadata directory outgrows one request. */
export const MAX_TEMPLATE_TOKENS = 1000

/** The token name a template resolves for one id, and the `{name}` a description interpolates. */
export const templateTokenName = (baseName, token) => `${baseName}${token}`

/**
 * Per-token metadata generated from a template instead of a zip: every token carries the
 * collection artwork, its own number in the name, and one description with `{name}` filled in.
 *
 * It exists because the alternative is what a drop used to launch with — every id pointing at the
 * one collection file, so a wallet showing #7 beside #700 shows the same name twice. A creator
 * with no per-token art still deserves numbered tokens.
 */
export function buildTemplateMetadataFiles({ standardId, count, baseName, description = '', imageUrl, imageHash }) {
  return Array.from({ length: count }, (_, index) => {
    const token = index + 1
    const name = templateTokenName(baseName, token)

    const metadata = buildTokenMetadata({
      standardId,
      token,
      imageUrl,
      imageHash,
      collectionName: baseName,
      entry: { name, description: description.replaceAll('{name}', name), attributes: [] },
    })

    return { name: metadataFileName(standardId, token), content: JSON.stringify(metadata, null, 2) }
  })
}

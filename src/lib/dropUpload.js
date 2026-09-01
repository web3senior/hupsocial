/**
 * @file lib/dropUpload.js
 * @description Turns a creator's zip into a numbered collection's metadata: reads the archive in
 * the browser, matches artwork to traits, and writes one metadata file per token in whichever
 * shape the drop's standard reads.
 *
 * The point of doing this here rather than asking the creator for a pinned folder is the
 * verification digests. LUKSO's LSP4Metadata carries a keccak256 of each image's bytes, which is
 * what makes the artwork tamper-evident — and computing one by hand, per file, across a thousand
 * images, is not something an artist will ever do. We are the ones pinning the bytes, so we are
 * the ones who can hash them, and the digest falls out of the upload for free.
 *
 * Nothing here touches the network. It reads bytes and produces bytes, so the whole pipeline is
 * testable without a wallet, a gateway, or a chain.
 */

import { keccak256 } from 'viem'
import { DROP_STANDARDS, isLuksoStandard } from '@/lib/drops'

// --- zip reading ---

/*
 * Enough of the zip format to read what an artist exports, and no more. The central directory is
 * the authority on what a zip contains — walking local headers instead would trip over data
 * descriptors, which is how streamed zips (anything produced by a `zip` command reading a pipe)
 * record their sizes.
 */
const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50
const MAX_COMMENT = 0xffff

const findEndOfCentralDirectory = (view) => {
  const min = Math.max(0, view.byteLength - MAX_COMMENT - 22)
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i
  }
  return -1
}

const inflateRaw = async (bytes) => {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * Reads a zip into its entries. Directories, empty files, and the junk archivers leave behind
 * (`__MACOSX/`, `.DS_Store`, `Thumbs.db`) are dropped here rather than being filtered by every
 * caller — an artist's zip from a Mac carries a shadow copy of every file, and treating those as
 * artwork would double the collection.
 *
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {Promise<Array<{name: string, bytes: Uint8Array}>>}
 */
export async function readZipEntries(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  const eocd = findEndOfCentralDirectory(view)
  if (eocd === -1) throw new Error('Not a zip file, or its directory is damaged')

  const count = view.getUint16(eocd + 10, true)
  let cursor = view.getUint32(eocd + 16, true)

  const entries = []
  for (let i = 0; i < count; i++) {
    if (view.getUint32(cursor, true) !== CENTRAL_SIG) throw new Error('Damaged zip: bad central directory entry')

    const method = view.getUint16(cursor + 10, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))

    cursor += 46 + nameLength + extraLength + commentLength

    if (name.endsWith('/')) continue
    if (isArchiverJunk(name)) continue

    // The local header repeats the name and extra fields, and its extra length can differ from
    // the central one — read it rather than reusing the central value.
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const raw = bytes.subarray(dataStart, dataStart + compressedSize)

    if (method !== 0 && method !== 8) throw new Error(`Unsupported compression in "${name}" — re-zip without encryption`)

    entries.push({ name, bytes: method === 0 ? raw : await inflateRaw(raw) })
  }

  return entries
}

/** Shadow files archivers add, which are never part of the artwork. */
export const isArchiverJunk = (name) => {
  const base = name.split('/').pop() ?? ''
  return name.startsWith('__MACOSX/') || base.startsWith('._') || base === '.DS_Store' || base === 'Thumbs.db'
}

// --- sorting a zip into artwork and traits ---

const IMAGE_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif' }

const extensionOf = (name) => (name.split('.').pop() ?? '').toLowerCase()
const baseNameOf = (name) => {
  const file = name.split('/').pop() ?? name
  const dot = file.lastIndexOf('.')
  return dot > 0 ? file.slice(0, dot) : file
}

/**
 * The token number a file belongs to. Artists number files every which way — `1.png`,
 * `001.png`, `hoodless_1.png`, `#1.png` — so take the last run of digits in the basename, which
 * survives all of those. A file with no digits at all has no place in a numbered collection.
 */
export const tokenNumberOf = (name) => {
  const matches = baseNameOf(name).match(/\d+/g)
  if (!matches) return null
  const n = parseInt(matches[matches.length - 1], 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Splits a read archive into artwork, an optional trait manifest, and the leftovers.
 * @param {Array<{name: string, bytes: Uint8Array}>} entries
 */
export function sortZipEntries(entries) {
  const images = []
  const jsonFiles = []
  const ignored = []

  for (const entry of entries) {
    const ext = extensionOf(entry.name)
    if (IMAGE_EXT[ext]) images.push({ ...entry, type: IMAGE_EXT[ext], token: tokenNumberOf(entry.name) })
    else if (ext === 'json') jsonFiles.push(entry)
    else if (ext === 'csv') jsonFiles.push(entry)
    else ignored.push(entry.name)
  }

  images.sort((a, b) => (a.token ?? Infinity) - (b.token ?? Infinity) || a.name.localeCompare(b.name))
  return { images, jsonFiles, ignored }
}

// --- the trait manifest ---

const parseCsv = (text) => {
  const rows = text.trim().split(/\r?\n/).map((line) => line.split(',').map((c) => c.trim().replace(/^"|"$/g, '')))
  const header = rows.shift() ?? []
  return rows.filter((r) => r.length && r.some(Boolean)).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

/**
 * Reads whatever the artist shipped alongside the art: one JSON array, a CSV, or a folder of
 * per-token JSON files. Returns a map of token number to `{ name, description, attributes }`,
 * empty when there is no manifest at all — art with no traits is a valid collection.
 */
export function readTraitManifest(jsonFiles) {
  const byToken = new Map()
  const decoder = new TextDecoder()

  /*
   * A single manifest describing everything. Matched on the BASENAME, never the path: the usual
   * generative-art layout is `metadata/1.json`, and testing the full path there sees the folder's
   * name and mistakes one token's file for the whole collection's manifest. A per-token file
   * always carries a number, so a name that is purely a manifest word is the honest signal.
   */
  const combined = jsonFiles.find((f) => {
    const base = (f.name.split('/').pop() ?? '').replace(/\.(json|csv)$/i, '')
    return /^_?(metadata|manifest|traits|attributes)$/i.test(base)
  })
  if (combined) {
    const text = decoder.decode(combined.bytes)
    let rows = []
    if (extensionOf(combined.name) === 'csv') rows = parseCsv(text)
    else {
      const parsed = JSON.parse(text)
      rows = Array.isArray(parsed) ? parsed : Object.entries(parsed).map(([k, v]) => ({ tokenId: k, ...v }))
    }

    rows.forEach((row, index) => {
      // An explicit id wins; otherwise position, 1-based, matching how ids are minted
      const token = Number(row.tokenId ?? row.token_id ?? row.id ?? row.edition ?? index + 1)
      if (!Number.isFinite(token) || token < 1) return
      byToken.set(token, normaliseManifestRow(row))
    })
    return byToken
  }

  // Otherwise, one JSON per token
  for (const file of jsonFiles) {
    const token = tokenNumberOf(file.name)
    if (!token) continue
    try {
      byToken.set(token, normaliseManifestRow(JSON.parse(decoder.decode(file.bytes))))
    } catch {
      // A single unreadable file should not lose the other thousand
    }
  }
  return byToken
}

/** Accepts the OpenSea shape, the LSP4 shape, or flat CSV columns, and lands on one form. */
const normaliseManifestRow = (row) => {
  const inner = row.LSP4Metadata ?? row
  const raw = inner.attributes ?? []

  let attributes = []
  if (Array.isArray(raw)) {
    attributes = raw
      .map((a) => ({ key: a.key ?? a.trait_type ?? a.traitType ?? '', value: a.value ?? '' }))
      .filter((a) => a.key !== '' && a.value !== '')
  } else if (raw && typeof raw === 'object') {
    attributes = Object.entries(raw).map(([key, value]) => ({ key, value }))
  }

  // Flat CSV columns become traits, minus the ones that are not traits
  if (!attributes.length) {
    const skip = new Set(['tokenid', 'token_id', 'id', 'edition', 'name', 'description', 'image', 'file', 'filename'])
    attributes = Object.entries(inner)
      .filter(([k, v]) => !skip.has(k.toLowerCase()) && v !== '' && typeof v !== 'object')
      .map(([key, value]) => ({ key, value }))
  }

  return { name: inner.name ?? '', description: inner.description ?? '', attributes }
}

// --- writing the per-token metadata ---

const attributeType = (value) => (typeof value === 'number' || (typeof value === 'string' && value !== '' && !Number.isNaN(Number(value))) ? 'number' : 'string')

/**
 * One token's metadata, in the shape its standard reads.
 *
 * LSP4Metadata is not the OpenSea convention wearing a different hat: it nests images as an
 * array of arrays (each inner array is one image at several sizes), keys attributes as
 * `{key, value, type}` rather than `{trait_type, value}`, and wraps the whole thing under an
 * `LSP4Metadata` key. Getting any of those wrong yields a file that pins and resolves and shows
 * nothing.
 */
export function buildTokenMetadata({ standardId, token, imageUrl, imageHash, collectionName, entry }) {
  const name = entry?.name || `${collectionName} #${token}`
  const description = entry?.description ?? ''
  const attributes = entry?.attributes ?? []

  if (isLuksoStandard(standardId)) {
    return {
      LSP4Metadata: {
        name,
        description,
        links: [],
        icon: [],
        images: [[{ width: 0, height: 0, url: imageUrl, verification: { method: 'keccak256(bytes)', data: imageHash || '0x' } }]],
        assets: [],
        attributes: attributes.map((a) => ({ key: a.key, value: String(a.value), type: attributeType(a.value) })),
      },
    }
  }

  return {
    name,
    description,
    image: imageUrl,
    attributes: attributes.map((a) => ({ trait_type: a.key, value: a.value })),
  }
}

/**
 * The filename a token's metadata must have inside the pinned folder.
 *
 * LSP8 resolves `LSP8TokenMetadataBaseURI + tokenId` and appends nothing else, so its files carry
 * no extension — naming them `1.json` is the quickest way to a collection whose metadata resolves
 * to nothing. ERC721 appends a suffix, so it wants the extension.
 */
export const metadataFileName = (standardId, token) => (isLuksoStandard(standardId) ? String(token) : `${token}.json`)

/** The Suffix field that pairs with `metadataFileName`. LSP8 has no suffix at all. */
export const metadataSuffix = (standardId) => (isLuksoStandard(standardId) ? '' : '.json')

/** keccak256 of a file's exact bytes — the digest LSP4 verification carries. */
export const hashBytes = (bytes) => keccak256(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))

/**
 * Everything a zip yields, checked before a creator is allowed to spend a minute uploading:
 * duplicate token numbers, gaps in the sequence, art with no number, and a count that does not
 * match the drop's supply. Returned as warnings and errors rather than thrown, so the preview can
 * show them all at once instead of one per attempt.
 */
export function validateCollection({ images, maxSupply }) {
  const errors = []
  const warnings = []

  const numbered = images.filter((i) => i.token !== null)
  const unnumbered = images.length - numbered.length
  if (unnumbered > 0) errors.push(`${unnumbered} file${unnumbered === 1 ? ' has' : 's have'} no number in the name — a numbered collection needs one per token`)

  const seen = new Map()
  for (const image of numbered) seen.set(image.token, (seen.get(image.token) ?? 0) + 1)
  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([token]) => token)
  if (duplicates.length) errors.push(`Token ${duplicates.slice(0, 5).join(', ')}${duplicates.length > 5 ? '…' : ''} appear${duplicates.length === 1 ? 's' : ''} more than once`)

  const tokens = [...seen.keys()].sort((a, b) => a - b)
  if (tokens.length) {
    if (tokens[0] !== 1) warnings.push(`Numbering starts at ${tokens[0]}, but token ids are minted from 1`)
    const gaps = []
    for (let i = 1; i <= tokens[tokens.length - 1] && gaps.length < 6; i++) if (!seen.has(i)) gaps.push(i)
    if (gaps.length) warnings.push(`Missing token${gaps.length === 1 ? '' : 's'} ${gaps.slice(0, 5).join(', ')}${gaps.length > 5 ? '…' : ''}`)
  }

  if (maxSupply > 0 && numbered.length !== maxSupply) {
    warnings.push(`${numbered.length} file${numbered.length === 1 ? '' : 's'} for a supply of ${maxSupply}`)
  }

  return { errors, warnings, tokenCount: numbered.length }
}

export const DROP_UPLOAD_STANDARDS = DROP_STANDARDS

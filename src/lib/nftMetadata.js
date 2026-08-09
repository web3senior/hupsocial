/**
 * @file lib/nftMetadata.js
 * @description Isomorphic ERC721/LSP8 metadata resolution. Runs unchanged on the server
 * (behind the DB-backed cache in lib/nftMetadataCache) and in the browser (as the fallback
 * path in hooks/useNftMetadata), so both tiers agree on what a token's artwork is.
 */

import { hexToString, zeroAddress } from 'viem'
import { LSP4_TOKEN_NAME_KEY, LSP4_METADATA_KEY, decodeVerifiableUri, pickLsp4Image, fetchMetadataJson } from '@/lib/lsp4'
import { resolveStorageUrl } from '@/lib/storageHelper'

// LSP8's second metadata mechanism: a collection-wide base URI the token id gets appended
// to (e.g. Chillwhales), instead of per-token LSP4Metadata (e.g. Dracos)
const LSP8_TOKEN_METADATA_BASE_URI_KEY = '0x1a7628600c3bac7101f53697f48df381ddc36b9015e7d7c9c5633d1252aa2843'
const LSP8_TOKEN_ID_FORMAT_KEY = '0xf675e9361af1c1664c1868cfa3eb97672d6b1a513aa5b81dec34c9ee330e818d'

export const erc721MetadataAbi = [
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'tokenURI',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
  },
]

export const lsp8MetadataAbi = [
  {
    type: 'function',
    name: 'getData',
    stateMutability: 'view',
    inputs: [{ name: 'dataKey', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes' }],
  },
  {
    type: 'function',
    name: 'getDataForTokenId',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenId', type: 'bytes32' },
      { name: 'dataKey', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bytes' }],
  },
]

// Ownership is the one question both standards answer identically, and the only one that
// distinguishes a token from an id somebody made up: an id that was never minted has no owner.
export const nftOwnerAbi = [
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'tokenOwnerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
]

// The two error names viem gives a call the EVM refused to execute: the contract reverted with
// data (a custom error like LSP8NonExistentTokenId), or the node reported a plain revert.
const REVERT_ERROR_NAMES = new Set(['ContractFunctionRevertedError', 'ExecutionRevertedError'])

/**
 * Whether a token id actually exists in its collection.
 *
 * Metadata cannot answer this. An id that was never minted still resolves to something —
 * resolveNftMetadata's last LSP8 tier is the collection's own document, which describes the
 * collection whatever id you hand it, and an ERC721 tokenURI is free to serve anything. Only
 * ownership is a statement about the token itself, and both standards revert when there is
 * no owner to name.
 *
 * Three-valued on purpose: a timed-out or rate-limited RPC is not evidence of absence, and
 * callers use this to decide what to cache and what to delete.
 *
 * @param {Object} params
 * @param {Object} params.publicClient viem client already bound to the right chain.
 * @param {string} params.collection NFT contract address.
 * @param {string} params.tokenId bytes32 hex for LSP8, decimal/bigint-ish for ERC721.
 * @param {boolean} params.isLsp8 True for LSP8 collections, false for ERC721.
 * @returns {Promise<boolean|null>} true or false when the chain answered, null when it didn't.
 */
export const tokenExists = async ({ publicClient, collection, tokenId, isLsp8 }) => {
  try {
    const owner = await publicClient.readContract({
      abi: nftOwnerAbi,
      address: collection,
      functionName: isLsp8 ? 'tokenOwnerOf' : 'ownerOf',
      args: [isLsp8 ? tokenId : BigInt(tokenId)],
    })
    // Reverting is the standard behaviour, but an ERC721 that hands back the zero address
    // instead is saying the same thing
    return owner !== zeroAddress
  } catch (error) {
    // A revert IS an answer. Anything else — a transport failure, a contract with no such
    // getter, an id that isn't even a number — leaves the question open.
    //
    // Matched by name rather than `instanceof`: this module is imported by the Next server
    // bundle and by the browser, and viem's classes are not one object across those bundling
    // layers — an error thrown by the transport's copy fails `instanceof` against the copy
    // this file imported, which silently turned every revert into "don't know" and made the
    // whole check a no-op. `name` travels on the instance and survives the boundary.
    const reverted = error?.walk?.((cause) => REVERT_ERROR_NAMES.has(cause?.name))
    return reverted ? false : null
  }
}

/**
 * True when an image reference carries its bytes inline rather than pointing at storage.
 * These are the collections that render entirely onchain — the artwork arrives as
 * `data:image/svg+xml;base64,…` straight out of the contract, with no IPFS CID anywhere.
 * @param {string} src
 * @returns {boolean}
 */
export const isInlineDataUri = (src) => typeof src === 'string' && src.startsWith('data:')

// A collection's 3D asset travels in the same document as its artwork: LSP4 lists files in
// `assets`, ERC721 hides them behind `animation_url` and friends. Only glb/gltf can be shown
// in a canvas, but the rest are still worth surfacing as a download rather than dropping.
const RENDERABLE_MODEL_TYPES = new Set(['glb', 'gltf'])
const MODEL_FILE_TYPES = new Set([...RENDERABLE_MODEL_TYPES, 'fbx', 'obj', 'usdz', 'usd', 'stl', 'dae', '3ds', 'ply', 'vrm'])

// Collections that declare a mime type rather than an extension
const MODEL_TYPE_ALIASES = { 'gltf-binary': 'glb', 'gltf+json': 'gltf', 'vnd.usdz+zip': 'usdz' }

/**
 * True for the model formats the app renders inline; everything else is download-only.
 * @param {string} fileType
 * @returns {boolean}
 */
export const isRenderableModelType = (fileType) => RENDERABLE_MODEL_TYPES.has(String(fileType || '').toLowerCase())

// Extension of the last path segment, or null when there isn't one. Deliberately not
// `split('.').pop()`: that reads the extension of `https://arweave.net/Rdsn…` as
// `net/Rdsn…` — a dot in the *host* is not a file extension.
const extensionOf = (url) => {
  const path = String(url || '').split(/[?#]/)[0]
  const segment = path.slice(path.lastIndexOf('/') + 1)
  const dot = segment.lastIndexOf('.')
  return dot === -1 ? null : segment.slice(dot + 1).toLowerCase()
}

// The document's declared type wins over the URL's extension, because storage references are
// usually extension-less CIDs (`ipfs://Qm…`) — the extension is only the fallback.
const modelTypeOf = (url, declared) => {
  const stripped = String(declared || '')
    .toLowerCase()
    .trim()
    .replace(/^\./, '')
    .replace(/^model\//, '')
  const normalized = MODEL_TYPE_ALIASES[stripped] || stripped
  if (MODEL_FILE_TYPES.has(normalized)) return normalized

  const extension = extensionOf(url)
  return extension && MODEL_FILE_TYPES.has(extension) ? extension : null
}

// Inline models are refused outright: a base64 mesh is megabytes the browser can never cache,
// and unlike artwork there is no proxy that could rasterize it into something smaller.
const toModel = (url, declared) => {
  if (!url || typeof url !== 'string' || isInlineDataUri(url)) return null
  const fileType = modelTypeOf(url, declared)
  return fileType ? { url, fileType } : null
}

// Some collections mint the mesh with neither a `fileType` on the asset entry nor an
// extension on the URL — an Arweave txid or a bare CID says nothing about what it holds, so
// the file has to be asked directly. Storage gateways serve the stored content type
// (`model/gltf-binary`), which MODEL_TYPE_ALIASES already understands; the ones that answer
// `application/octet-stream` still can't disguise the magic bytes at the head of a GLB.
const GLB_MAGIC = 'glTF'
// A document listing dozens of unlabelled files is malformed rather than interesting — probe
// the first few and let the rest stay unrecognized.
const MAX_SNIFFED_ASSETS = 3
// The whole second pass, wall clock. Candidates are probed concurrently, so this is the cost
// of the slowest one rather than their sum — the batch endpoint resolves a grid of tokens
// through a fixed worker pool, and a probe that held a worker per asset would stall the tile
// behind it for a multiple of this.
const SNIFF_BUDGET_MS = 8000
const SNIFF_ATTEMPT_MS = 4000
// Storage gateways are noticeably slower on a cold object than a warm one, and a first
// attempt that timed out has usually warmed it. Worth one retry: the answer here is written
// into the metadata cache for a week, so a transient miss is not a transient symptom.
const SNIFF_ATTEMPTS = 2

// A ranged GET answers both halves of the question in one round trip: 206 or not, the
// response still carries the stored Content-Type, and the body still starts with the file's
// magic bytes. (A HEAD would be cheaper but several gateways simply never answer one.)
const probeModelType = async (target, url, timeoutMs) => {
  const response = await fetch(target, { headers: { range: `bytes=0-${GLB_MAGIC.length - 1}` }, signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok || !response.body) return null

  const declared = modelTypeOf(url, response.headers.get('content-type')?.split(';')[0])

  // Servers are free to ignore `Range` — and they do, so the response in hand may be the
  // entire mesh. Take the first chunk and drop the connection rather than draining it.
  const reader = response.body.getReader()
  const { value } = await reader.read()
  reader.cancel().catch(() => {})

  if (declared) return declared
  if (!value) return null
  // Nothing useful in the header (`application/octet-stream` is the common case), but a GLB
  // still can't disguise its first four bytes.
  return new TextDecoder().decode(value.slice(0, GLB_MAGIC.length)) === GLB_MAGIC ? 'glb' : null
}

const sniffModelType = async (url, deadline) => {
  const target = resolveStorageUrl(url)
  if (!target || !/^https?:\/\//i.test(target)) return null

  for (let attempt = 0; attempt < SNIFF_ATTEMPTS; attempt += 1) {
    const remaining = Math.min(SNIFF_ATTEMPT_MS, deadline - Date.now())
    if (remaining <= 0) break
    try {
      return await probeModelType(target, url, remaining)
    } catch {
      // Timed out or the gateway dropped it; fall through to the retry, if there is time.
    }
  }
  return null
}

// Only ever a second pass. Anything the document labelled has already been claimed, and a URL
// that carries an extension has told us what it is even when that answer is "not a model" —
// so a collection with well-formed metadata never spends a request here.
const sniffModel = async (urls) => {
  const candidates = urls.filter((url) => url && typeof url === 'string' && !isInlineDataUri(url) && !extensionOf(url)).slice(0, MAX_SNIFFED_ASSETS)
  if (candidates.length === 0) return null

  const deadline = Date.now() + SNIFF_BUDGET_MS
  const results = await Promise.all(candidates.map((url) => sniffModelType(url, deadline)))
  // Document order decides, not whichever gateway answered first — the collection listed its
  // primary asset first and that shouldn't depend on CDN warmth.
  const index = results.findIndex(Boolean)
  return index === -1 ? null : { url: candidates[index], fileType: results[index] }
}

// LSP4 `assets` is a flat list of {url, fileType} files — but it also carries asset
// *references* ({address, tokenId}) that have no url, and a few collections nest it the way
// `images` is nested, hence the flatten.
const pickLsp4Model = async (lsp4) => {
  const assets = Array.isArray(lsp4?.assets) ? lsp4.assets.flat() : []
  for (const asset of assets) {
    const model = toModel(asset?.url, asset?.fileType)
    if (model) return model
  }
  return sniffModel(assets.filter((asset) => !asset?.fileType).map((asset) => asset?.url))
}

// `animation_url` is a grab-bag — mp4, interactive HTML and glb all share it — so it only
// counts once it actually names a model format.
const pickErc721Model = async (json) => {
  const candidates = [
    [json?.model_url, json?.model_type],
    [json?.glb_url, 'glb'],
    [json?.animation_url, json?.animation_details?.format],
  ]
  for (const [url, declared] of candidates) {
    const model = toModel(url, declared)
    if (model) return model
  }
  return sniffModel(candidates.filter(([, declared]) => !declared).map(([url]) => url))
}

// Traits come in two dialects: ERC721's [{trait_type, value}] and LSP4's [{key, value, type}].
// Normalize both to [{label, value}] strings for display.
const normalizeAttributes = (json, lsp4) => {
  const raw = (Array.isArray(json?.attributes) && json.attributes.length > 0 ? json.attributes : lsp4?.attributes) || []
  if (!Array.isArray(raw)) return []
  return raw
    .map((attr) => ({ label: attr?.trait_type ?? attr?.key, value: attr?.value }))
    .filter((attr) => attr.label && attr.value !== null && attr.value !== undefined && `${attr.value}`.trim() !== '')
    .map((attr) => ({ label: String(attr.label), value: String(attr.value) }))
}

// How a bytes32 token id is appended to LSP8TokenMetadataBaseURI, per LSP8TokenIdFormat:
// 0 = uint256 (decimal), 1 = utf8 string, 2 = address, 3/4 = raw bytes32 hex without 0x.
// The 100+ values are the same formats with per-token overrides — same string mapping.
const formatTokenIdForUri = (tokenId, formatBytes) => {
  let format = 0
  try {
    if (formatBytes && formatBytes !== '0x') format = Number(BigInt(formatBytes)) % 100
  } catch {
    format = 0
  }
  if (format === 0) return BigInt(tokenId).toString()
  if (format === 1) {
    try {
      return hexToString(tokenId).replace(/\0+$/, '')
    } catch {
      return null
    }
  }
  if (format === 2) return `0x${tokenId.slice(-40)}`
  return tokenId.slice(2)
}

/**
 * Reads display metadata for one token straight from its contract.
 * @param {Object} params
 * @param {Object} params.publicClient viem client already bound to the right chain.
 * @param {string} params.collection NFT contract address.
 * @param {string} params.tokenId bytes32 hex for LSP8, decimal/bigint-ish for ERC721.
 * @param {boolean} params.isLsp8 True for LSP8 collections, false for ERC721.
 * @param {string} [params.baseUrl] Absolute origin for resolving proxy-relative
 * metadata URLs — required server-side, omitted in the browser.
 * @returns {Promise<{name: string|null, collectionName: string|null, description: string|null,
 * image: string|null, model: {url: string, fileType: string}|null,
 * attributes: Array<{label: string, value: string}>, source: string|null}>}
 */
export const resolveNftMetadata = async ({ publicClient, collection, tokenId, isLsp8, baseUrl }) => {
  if (isLsp8) {
    const [nameBytes, tokenMetadataBytes, baseUriBytes, tokenIdFormatBytes, collectionMetadataBytes] = await Promise.all([
      publicClient.readContract({ abi: lsp8MetadataAbi, address: collection, functionName: 'getData', args: [LSP4_TOKEN_NAME_KEY] }).catch(() => null),
      publicClient.readContract({ abi: lsp8MetadataAbi, address: collection, functionName: 'getDataForTokenId', args: [tokenId, LSP4_METADATA_KEY] }).catch(() => null),
      publicClient.readContract({ abi: lsp8MetadataAbi, address: collection, functionName: 'getData', args: [LSP8_TOKEN_METADATA_BASE_URI_KEY] }).catch(() => null),
      publicClient.readContract({ abi: lsp8MetadataAbi, address: collection, functionName: 'getData', args: [LSP8_TOKEN_ID_FORMAT_KEY] }).catch(() => null),
      publicClient.readContract({ abi: lsp8MetadataAbi, address: collection, functionName: 'getData', args: [LSP4_METADATA_KEY] }).catch(() => null),
    ])

    let collectionName = null
    if (nameBytes && nameBytes !== '0x') {
      try {
        collectionName = hexToString(nameBytes).trim() || null
      } catch {
        collectionName = null
      }
    }

    // Resolution order: per-token LSP4Metadata (Dracos-style), then the collection's token
    // base URI + formatted token id (Chillwhales-style), then collection-level LSP4Metadata
    // as the last resort — that one only knows the collection, not the token, so `source`
    // records which tier answered and consumers can label collection-only data honestly.
    let source = 'token'
    let uri = decodeVerifiableUri(tokenMetadataBytes)
    if (!uri) {
      const resolvedBaseUri = decodeVerifiableUri(baseUriBytes)
      const tokenIdSegment = resolvedBaseUri ? formatTokenIdForUri(tokenId, tokenIdFormatBytes) : null
      if (resolvedBaseUri && tokenIdSegment !== null) uri = `${resolvedBaseUri}${tokenIdSegment}`
    }
    if (!uri) {
      uri = decodeVerifiableUri(collectionMetadataBytes)
      source = uri ? 'collection' : null
    }

    const json = await fetchMetadataJson(uri, { baseUrl }).catch(() => null)
    const lsp4 = json?.LSP4Metadata || json

    return {
      name: lsp4?.name || collectionName,
      collectionName,
      description: lsp4?.description || null,
      image: pickLsp4Image(lsp4),
      model: await pickLsp4Model(lsp4),
      attributes: normalizeAttributes(json, lsp4),
      source: json ? source : null,
    }
  }

  const [collectionName, tokenUri] = await Promise.all([
    publicClient.readContract({ abi: erc721MetadataAbi, address: collection, functionName: 'name' }).catch(() => null),
    publicClient.readContract({ abi: erc721MetadataAbi, address: collection, functionName: 'tokenURI', args: [BigInt(tokenId)] }).catch(() => null),
  ])

  const json = await fetchMetadataJson(tokenUri, { baseUrl }).catch(() => null)

  return {
    name: json?.name || (collectionName ? `${collectionName} #${BigInt(tokenId)}` : null),
    collectionName,
    description: json?.description || null,
    image: json?.image || json?.image_url || null,
    model: await pickErc721Model(json),
    attributes: normalizeAttributes(json, null),
    // tokenURI is inherently per-token
    source: json ? 'token' : null,
  }
}

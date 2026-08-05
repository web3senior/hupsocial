/**
 * @file lib/collectionMetadata.js
 * @description Collection-level display metadata for ERC721/LSP8 contracts — the identity a
 * whole collection shares (name, symbol, banner, description, creators, supply), as opposed
 * to lib/nftMetadata's per-token resolution. Consumed server-side through
 * lib/collectionMetadataCache, the same way nftMetadata sits behind nftMetadataCache.
 */

import { hexToString } from 'viem'
import { LSP4_TOKEN_NAME_KEY, LSP4_METADATA_KEY, erc725yGetDataAbi, decodeVerifiableUri, fetchMetadataJson } from '@/lib/lsp4'

// keccak256 data keys per the LSP4 spec, like the ones in lib/lsp4
const LSP4_TOKEN_SYMBOL_KEY = '0x2f0a68ab07768e01943a599e73362a0e17a63a72e94dd2e384d2c1d4db932756'
const LSP4_CREATORS_ARRAY_KEY = '0x114bd03b3a46d48759680d81ebb2b414fda7d030a7105a851867accf1c2352e7'

// Creators beyond this stay onchain-only — the UI shows a couple of profile chips, not a
// registry, and each extra creator is another storage read plus a profile resolution.
const MAX_CREATORS = 4

const ZERO_ADDRESS = `0x${'0'.repeat(40)}`

const erc721CollectionAbi = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
]

// LSP8 always has totalSupply; on the ERC721 side it's the Enumerable extension, so the
// read is best-effort on both paths
const totalSupplyAbi = [{ type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] }]

const decodeUtf8Bytes = (bytes) => {
  if (!bytes || bytes === '0x') return null
  try {
    return hexToString(bytes).trim() || null
  } catch {
    return null
  }
}

// LSP2 array element key: the first 16 bytes of the array's own key + the index as uint128
const creatorKeyAt = (index) => `${LSP4_CREATORS_ARRAY_KEY.slice(0, 34)}${index.toString(16).padStart(32, '0')}`

const decodeArrayLength = (bytes) => {
  if (!bytes || bytes === '0x') return 0
  try {
    return Number(BigInt(bytes))
  } catch {
    return 0
  }
}

const decodeCreatorAddress = (bytes) => {
  if (!bytes || typeof bytes !== 'string' || bytes.length < 42) return null
  const address = `0x${bytes.slice(-40)}`.toLowerCase()
  return /^0x[0-9a-f]{40}$/.test(address) && address !== ZERO_ADDRESS ? address : null
}

// LSP4/LSP3 image fields arrive flat ([{url, width}]) or nested ([[{…}]]) depending on the
// minter — flatten either shape, then take the widest variant so a banner never upscales a
// thumbnail. Consumers shrink through the image proxy anyway.
const pickWidestImage = (value) => {
  const entries = Array.isArray(value) ? value.flat() : []
  let best = null
  for (const entry of entries) {
    if (!entry?.url || typeof entry.url !== 'string') continue
    if (!best || (Number(entry.width) || 0) > (Number(best.width) || 0)) best = entry
  }
  return best?.url || null
}

/**
 * Reads a collection's shared display metadata straight from its contract.
 * @param {Object} params
 * @param {Object} params.publicClient viem client already bound to the right chain.
 * @param {string} params.collection NFT contract address.
 * @param {boolean} params.isLsp8 True for LSP8 collections, false for ERC721.
 * @param {string} [params.baseUrl] Absolute origin for resolving proxy-relative metadata
 * URLs — required server-side, where fetch has no document origin.
 * @returns {Promise<{name: string|null, symbol: string|null, description: string|null,
 * banner: string|null, icon: string|null, creators: string[], totalSupply: string|null,
 * source: string|null}>}
 */
export const resolveCollectionMetadata = async ({ publicClient, collection, isLsp8, baseUrl }) => {
  if (!isLsp8) {
    const [name, symbol, totalSupply] = await Promise.all([
      publicClient.readContract({ abi: erc721CollectionAbi, address: collection, functionName: 'name' }).catch(() => null),
      publicClient.readContract({ abi: erc721CollectionAbi, address: collection, functionName: 'symbol' }).catch(() => null),
      publicClient.readContract({ abi: totalSupplyAbi, address: collection, functionName: 'totalSupply' }).catch(() => null),
    ])

    return {
      name: name || null,
      symbol: symbol || null,
      description: null,
      banner: null,
      icon: null,
      creators: [],
      totalSupply: totalSupply === null ? null : totalSupply.toString(),
      // ERC721 keeps no offchain document at the collection level — the contract reads are
      // the whole story, so they count as complete whenever anything answered
      source: name || symbol || totalSupply !== null ? 'contract' : null,
    }
  }

  const getData = (dataKey) =>
    publicClient.readContract({ abi: erc725yGetDataAbi, address: collection, functionName: 'getData', args: [dataKey] }).catch(() => null)

  const [nameBytes, symbolBytes, metadataBytes, creatorsLengthBytes, totalSupply] = await Promise.all([
    getData(LSP4_TOKEN_NAME_KEY),
    getData(LSP4_TOKEN_SYMBOL_KEY),
    getData(LSP4_METADATA_KEY),
    getData(LSP4_CREATORS_ARRAY_KEY),
    publicClient.readContract({ abi: totalSupplyAbi, address: collection, functionName: 'totalSupply' }).catch(() => null),
  ])

  const creatorsLength = Math.min(decodeArrayLength(creatorsLengthBytes), MAX_CREATORS)
  const creatorReads = creatorsLength > 0 ? await Promise.all(Array.from({ length: creatorsLength }, (_, index) => getData(creatorKeyAt(index)))) : []
  const creators = [...new Set(creatorReads.map(decodeCreatorAddress).filter(Boolean))]

  const uri = decodeVerifiableUri(metadataBytes)
  const json = uri ? await fetchMetadataJson(uri, { baseUrl }).catch(() => null) : null
  const lsp4 = json?.LSP4Metadata || json

  const name = decodeUtf8Bytes(nameBytes)
  const symbol = decodeUtf8Bytes(symbolBytes)

  // The banner falls back to the first entry of `images` (its variants only — a later image
  // is a different artwork, not another size of the cover) when the collection ships no
  // backgroundImage. backgroundImage itself is one conceptual image however it's nested.
  const firstImageVariants = Array.isArray(lsp4?.images?.[0]) ? lsp4.images[0] : lsp4?.images

  // 'lsp4' = the offchain document answered; 'contract' = the collection simply has no
  // LSP4Metadata pointer set, so the onchain reads are all there will ever be; null = a
  // pointer exists but the document didn't come back — transient, cached briefly and retried.
  let source = null
  if (json) source = 'lsp4'
  else if (!uri && (name || symbol || totalSupply !== null)) source = 'contract'

  return {
    name,
    symbol,
    description: typeof lsp4?.description === 'string' && lsp4.description.trim() ? lsp4.description.trim() : null,
    banner: pickWidestImage(lsp4?.backgroundImage) || pickWidestImage(firstImageVariants),
    icon: pickWidestImage(lsp4?.icon),
    creators,
    totalSupply: totalSupply === null ? null : totalSupply.toString(),
    source,
  }
}

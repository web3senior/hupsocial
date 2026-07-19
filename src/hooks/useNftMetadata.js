'use client'

import useSWRImmutable from 'swr/immutable'
import { usePublicClient } from 'wagmi'
import { hexToString } from 'viem'
import { resolveStorageUrl, resolveStorageImageUrl } from '@/lib/storageHelper'

// LSP4 metadata lives in ERC725Y storage — keccak256 data keys per the LSP4 spec
const LSP4_TOKEN_NAME_KEY = '0xdeba1e292f8ba88238e10ab3c7f88bd4be4fac56cad5194b6ecceaf653468af1'
const LSP4_METADATA_KEY = '0x9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e'
// LSP8's second metadata mechanism: a collection-wide base URI the token id gets appended
// to (e.g. Chillwhales), instead of per-token LSP4Metadata (e.g. Dracos)
const LSP8_TOKEN_METADATA_BASE_URI_KEY = '0x1a7628600c3bac7101f53697f48df381ddc36b9015e7d7c9c5633d1252aa2843'
const LSP8_TOKEN_ID_FORMAT_KEY = '0xf675e9361af1c1664c1868cfa3eb97672d6b1a513aa5b81dec34c9ee330e818d'

const erc721MetadataAbi = [
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

const lsp8MetadataAbi = [
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

// A VerifiableURI (LSP2) is `0x0000` + bytes4 verification method + bytes2 hash length +
// hash + utf8 url. Rather than trusting every collection to encode it perfectly, decode the
// whole payload as text and pull the trailing url out of it.
const decodeVerifiableUri = (bytes) => {
  if (!bytes || bytes === '0x') return null
  let text
  try {
    text = hexToString(bytes)
  } catch {
    return null
  }
  const match = text.match(/(ipfs:\/\/|https?:\/\/|ar:\/\/|data:)[\x20-\x7E]*$/)
  return match ? match[0] : null
}

// LSP4Metadata images are size-variant arrays; the first variant of the first image is the
// canonical one. Icon is the square fallback.
const pickLsp4Image = (lsp4) => lsp4?.images?.[0]?.[0]?.url || lsp4?.icon?.[0]?.url || null

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

const fetchMetadataJson = async (uri) => {
  if (!uri) return null
  if (uri.startsWith('data:application/json')) {
    const payload = uri.slice(uri.indexOf(',') + 1)
    return JSON.parse(uri.includes(';base64') ? atob(payload) : decodeURIComponent(payload))
  }
  const response = await fetch(resolveStorageUrl(uri))
  if (!response.ok) return null
  return response.json()
}

const fetchNftMetadata = async ({ publicClient, collection, tokenId, isLsp8 }) => {
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
      const baseUri = decodeVerifiableUri(baseUriBytes)
      const tokenIdSegment = baseUri ? formatTokenIdForUri(tokenId, tokenIdFormatBytes) : null
      if (baseUri && tokenIdSegment !== null) uri = `${baseUri}${tokenIdSegment}`
    }
    if (!uri) {
      uri = decodeVerifiableUri(collectionMetadataBytes)
      source = uri ? 'collection' : null
    }

    const json = await fetchMetadataJson(uri).catch(() => null)
    const lsp4 = json?.LSP4Metadata || json

    return {
      name: lsp4?.name || collectionName,
      collectionName,
      description: lsp4?.description || null,
      image: pickLsp4Image(lsp4),
      attributes: normalizeAttributes(json, lsp4),
      source: json ? source : null,
    }
  }

  const [collectionName, tokenUri] = await Promise.all([
    publicClient.readContract({ abi: erc721MetadataAbi, address: collection, functionName: 'name' }).catch(() => null),
    publicClient.readContract({ abi: erc721MetadataAbi, address: collection, functionName: 'tokenURI', args: [BigInt(tokenId)] }).catch(() => null),
  ])

  const json = await fetchMetadataJson(tokenUri).catch(() => null)

  return {
    name: json?.name || (collectionName ? `${collectionName} #${BigInt(tokenId)}` : null),
    collectionName,
    description: json?.description || null,
    image: json?.image || json?.image_url || null,
    attributes: normalizeAttributes(json, null),
    // tokenURI is inherently per-token
    source: json ? 'token' : null,
  }
}

/**
 * Resolves display metadata (name, collection name, image) for an ERC721 or LSP8 token.
 * Results are cached immutably per (chain, collection, tokenId) — NFT metadata is treated
 * as static for the session so feed scrolling never refetches it.
 * @param {Object} params
 * @param {number} params.chainId Chain the collection lives on.
 * @param {string} params.collection NFT contract address.
 * @param {string} params.tokenId Token id — bytes32 hex for LSP8, decimal/bigint-ish for ERC721.
 * @param {boolean} params.isLsp8 True for LSP8 collections, false for ERC721.
 * @param {boolean} [params.enabled=true] Skip fetching while inputs are incomplete.
 * @param {number} [params.imageWidth=512] Width hint for the proxied image URL.
 */
export default function useNftMetadata({ chainId, collection, tokenId, isLsp8, enabled = true, imageWidth = 512 }) {
  const publicClient = usePublicClient({ chainId })
  const ready = Boolean(enabled && publicClient && collection && tokenId !== undefined && tokenId !== null && tokenId !== '')

  const { data, error, isLoading } = useSWRImmutable(
    ready ? ['nft-metadata', chainId, collection.toLowerCase(), String(tokenId), Boolean(isLsp8)] : null,
    () => fetchNftMetadata({ publicClient, collection, tokenId, isLsp8 }),
  )

  return {
    name: data?.name || null,
    collectionName: data?.collectionName || null,
    description: data?.description || null,
    image: data?.image ? resolveStorageImageUrl(data.image, { width: imageWidth }) : null,
    attributes: data?.attributes || [],
    // 'token' = data is specific to this token id; 'collection' = only collection-level
    // metadata exists and the image/name describe the collection, not the token
    source: data?.source || null,
    isLoading: ready && isLoading,
    error,
  }
}

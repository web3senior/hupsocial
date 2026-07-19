'use client'

import useSWRImmutable from 'swr/immutable'
import { usePublicClient } from 'wagmi'
import { hexToString } from 'viem'
import { resolveStorageUrl, resolveStorageImageUrl } from '@/lib/storageHelper'

// LSP4 metadata lives in ERC725Y storage — keccak256 data keys per the LSP4 spec
const LSP4_TOKEN_NAME_KEY = '0xdeba1e292f8ba88238e10ab3c7f88bd4be4fac56cad5194b6ecceaf653468af1'
const LSP4_METADATA_KEY = '0x9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e'

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
    const [nameBytes, tokenMetadataBytes, collectionMetadataBytes] = await Promise.all([
      publicClient.readContract({ abi: lsp8MetadataAbi, address: collection, functionName: 'getData', args: [LSP4_TOKEN_NAME_KEY] }).catch(() => null),
      publicClient.readContract({ abi: lsp8MetadataAbi, address: collection, functionName: 'getDataForTokenId', args: [tokenId, LSP4_METADATA_KEY] }).catch(() => null),
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

    // Per-token metadata wins; collections that only set collection-level LSP4Metadata fall back
    const uri = decodeVerifiableUri(tokenMetadataBytes) || decodeVerifiableUri(collectionMetadataBytes)
    const json = await fetchMetadataJson(uri).catch(() => null)
    const lsp4 = json?.LSP4Metadata || json

    return {
      name: lsp4?.name || collectionName,
      collectionName,
      description: lsp4?.description || null,
      image: pickLsp4Image(lsp4),
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
    isLoading: ready && isLoading,
    error,
  }
}

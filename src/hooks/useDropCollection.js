'use client'

import { useMemo } from 'react'
import useSWR from 'swr'
import { useReadContract } from 'wagmi'
import { LSP4_DATA_KEYS, decodeDataString, decodeVerifiableURI, isLuksoStandard } from '@/lib/drops'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import collectionAbi from '@/abis/HupDropCollection.json'

const jsonFetcher = (url) => fetch(url).then((res) => res.json())

/**
 * useDropCollection
 * Chain-aware identity for a drop's collection contract. EVM collections (ERC721/1155) expose
 * name()/symbol()/contractURI(); LSP7/LSP8 collections have none of those — their identity
 * lives in ERC725Y data keys (LSP4TokenName/Symbol, and an LSP4Metadata VerifiableURI whose
 * JSON nests everything under `LSP4Metadata`). This hook reads whichever family
 * `standardId` says the collection speaks and normalizes the result, so pages never
 * branch on the standard themselves.
 *
 * @param {Object} params
 * @param {number} params.chainId The chain the collection lives on.
 * @param {string|null} params.collection Collection address (null disables all reads).
 * @param {number|undefined} params.standardId The drop's standard id (1/2 EVM, 3/4 LUKSO).
 * @returns {{ name: string, symbol: string, description: string, image: string, links: Array,
 *   metadataUri: string|null, metadata: Object|undefined, refreshMetadata: Function }}
 */
export function useDropCollection({ chainId, collection, standardId }) {
  const isLukso = isLuksoStandard(standardId)
  const enabled = Boolean(collection && standardId !== undefined)

  const read = { abi: collectionAbi, address: collection ?? undefined, chainId }

  const { data: evmName } = useReadContract({ ...read, functionName: 'name', query: { enabled: enabled && !isLukso } })
  const { data: evmSymbol } = useReadContract({ ...read, functionName: 'symbol', query: { enabled: enabled && !isLukso } })
  const { data: contractURI } = useReadContract({ ...read, functionName: 'contractURI', query: { enabled: enabled && !isLukso } })

  const { data: lsp4Values } = useReadContract({
    ...read,
    functionName: 'getDataBatch',
    args: [[LSP4_DATA_KEYS.name, LSP4_DATA_KEYS.symbol, LSP4_DATA_KEYS.metadata]],
    query: { enabled: enabled && isLukso },
  })

  const metadataUri = useMemo(() => {
    if (isLukso) return lsp4Values ? decodeVerifiableURI(lsp4Values[2]) : null
    return contractURI || null
  }, [isLukso, lsp4Values, contractURI])

  const { data: metadata, mutate: refreshMetadata } = useSWR(metadataUri ? resolveStorageImageUrl(metadataUri) : null, jsonFetcher)

  // LSP4 metadata JSON nests under `LSP4Metadata`; EVM contractURI JSON is flat
  const body = metadata?.LSP4Metadata ?? metadata

  return {
    name: (isLukso ? decodeDataString(lsp4Values?.[0]) : evmName) || body?.name || '',
    symbol: (isLukso ? decodeDataString(lsp4Values?.[1]) : evmSymbol) || body?.symbol || '',
    description: body?.description || '',
    image: body?.images?.[0]?.[0]?.url || body?.image || '',
    // LSP4's separate square logo; EVM metadata has no standard slot for it, so a plain
    // `icon` key carries it there
    icon: body?.icon?.[0]?.[0]?.url || (typeof body?.icon === 'string' ? body.icon : '') || '',
    // LSP4Metadata nests the collection banner like images; EVM contractURI uses OpenSea's
    // contract-level `banner_image` field
    banner: body?.backgroundImage?.[0]?.[0]?.url || body?.banner_image || '',
    links: Array.isArray(body?.links) ? body.links : [],
    metadataUri,
    metadata,
    refreshMetadata,
  }
}

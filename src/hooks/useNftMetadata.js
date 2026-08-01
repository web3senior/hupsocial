'use client'

import { useCallback, useState } from 'react'
import useSWRImmutable from 'swr/immutable'
import { usePublicClient } from 'wagmi'
import { resolveStorageImageUrl, resolveStorageUrl } from '@/lib/storageHelper'
import { resolveNftMetadata, isInlineDataUri, isRenderableModelType } from '@/lib/nftMetadata'
import { loadNftMetadata } from '@/lib/nftMetadataBatch'

// Fully onchain collections return their artwork inline as a data: URI. Those can't be
// HTTP-cached and bloat the DOM, so the server hands back a /api/nft/image reference
// instead — which still needs the caller's size hints appended.
const withImageHints = (url, { width, quality, still }) => {
  const params = []
  if (width) params.push(`w=${width}`)
  if (quality) params.push(`q=${quality}`)
  if (still) params.push('still=1')
  if (params.length === 0) return url
  return `${url}${url.includes('?') ? '&' : '?'}${params.join('&')}`
}

const fetchNftMetadata = async ({ publicClient, chainId, collection, tokenId, isLsp8 }) => {
  try {
    // Coalesced with every other card mounting in the same tick — see lib/nftMetadataBatch.
    return await loadNftMetadata({ chainId: Number(chainId), collection, tokenId: String(tokenId), isLsp8: Boolean(isLsp8) })
  } catch (error) {
    // The server-side cache is an optimization, not a dependency — if it or the database
    // is down, resolve straight from the contract the way this hook always used to.
    console.warn('[useNftMetadata] cache unavailable, reading from chain:', error.message)
    if (!publicClient) throw error
    const metadata = await resolveNftMetadata({ publicClient, collection, tokenId, isLsp8 })
    return { ...metadata, imageIsProxied: false }
  }
}

/**
 * Resolves display metadata (name, collection name, image) for an ERC721 or LSP8 token.
 * Reads through the server-side nft_metadata_cache, so repeat views across sessions and
 * visitors cost a row lookup rather than an RPC fan-out; results are additionally cached
 * immutably per (chain, collection, tokenId) for the session so feed scrolling never refetches.
 * @param {Object} params
 * @param {number} params.chainId Chain the collection lives on.
 * @param {string} params.collection NFT contract address.
 * @param {string} params.tokenId Token id — bytes32 hex for LSP8, decimal/bigint-ish for ERC721.
 * @param {boolean} params.isLsp8 True for LSP8 collections, false for ERC721.
 * @param {boolean} [params.enabled=true] Skip fetching while inputs are incomplete.
 * @param {number} [params.imageWidth=512] Width hint for the proxied image URL.
 * @param {boolean} [params.still=false] First-frame-only for animated images — skips the
 * expensive animated re-encode for thumbnail contexts that don't render motion anyway.
 */
export default function useNftMetadata({ chainId, collection, tokenId, isLsp8, enabled = true, imageWidth = 512, still = false }) {
  const publicClient = usePublicClient({ chainId })
  const ready = Boolean(enabled && collection && tokenId !== undefined && tokenId !== null && tokenId !== '')

  const { data, error, isLoading, mutate } = useSWRImmutable(
    ready ? ['nft-metadata', chainId, collection.toLowerCase(), String(tokenId), Boolean(isLsp8)] : null,
    () => fetchNftMetadata({ publicClient, chainId, collection, tokenId, isLsp8 }),
  )

  const [isRefreshing, setIsRefreshing] = useState(false)

  // Collections that update their onchain metadata give the app no signal, so a cached token
  // would otherwise show its old name and artwork until the TTL lapsed. This re-reads it from
  // chain on demand and writes the result straight into the SWR cache, so the card updates in
  // place. Throttled server-side per token; a 429 surfaces to the caller as an Error.
  const refresh = useCallback(async () => {
    if (!ready || isRefreshing) return null
    setIsRefreshing(true)
    try {
      const response = await fetch('/api/v1/nfts/metadata/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chainId: Number(chainId), collection, tokenId: String(tokenId), isLsp8: Boolean(isLsp8) }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || !body?.success) throw new Error(body?.error || `Refresh failed (${response.status})`)

      await mutate(body.data, { revalidate: false })
      return body.data
    } finally {
      setIsRefreshing(false)
    }
  }, [ready, isRefreshing, chainId, collection, tokenId, isLsp8, mutate])

  let image = null
  if (data?.image) {
    if (data.imageIsProxied) {
      image = withImageHints(data.image, { width: imageWidth, still })
    } else if (isInlineDataUri(data.image)) {
      // Only reachable on the RPC fallback path — degraded, but it still renders.
      image = data.image
    } else {
      image = resolveStorageImageUrl(data.image, { width: imageWidth, still })
    }
  }

  // 3D files route through the plain storage resolver, never the image proxy — the mesh has
  // to arrive intact, and sharp would either mangle it or refuse it outright.
  let model = null
  const modelUrl = data?.model?.url ? resolveStorageUrl(data.model.url) : null
  if (modelUrl) {
    model = {
      url: modelUrl,
      fileType: data.model.fileType || null,
      // Formats the viewer can't paint (fbx, usdz, …) still surface — as a download.
      isRenderable: isRenderableModelType(data.model.fileType),
    }
  }

  return {
    name: data?.name || null,
    collectionName: data?.collectionName || null,
    description: data?.description || null,
    image,
    // {url, fileType, isRenderable} for the token's 3D asset, or null when it has none.
    model,
    attributes: data?.attributes || [],
    // 'token' = data is specific to this token id; 'collection' = only collection-level
    // metadata exists and the image/name describe the collection, not the token
    source: data?.source || null,
    isLoading: ready && isLoading,
    error,
    // Re-reads this token from chain, for collections that changed their onchain metadata.
    refresh,
    isRefreshing,
  }
}

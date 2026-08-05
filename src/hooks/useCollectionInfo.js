'use client'

import { useCallback, useState } from 'react'
import useSWRImmutable from 'swr/immutable'
import { getNftCollectionInfo } from '@/lib/api'
import { resolveStorageImageUrl } from '@/lib/storageHelper'

/**
 * Resolves collection-level display metadata (name, symbol, banner, icon, description,
 * creators, supply) for an ERC721/LSP8 contract through the server-side
 * nft_collection_cache. Cached immutably per (chain, collection) for the session, so the
 * collection page and any listing strips pointing at it share one fetch.
 * @param {Object} params
 * @param {number|string} params.chainId Chain the collection lives on.
 * @param {string} params.collection NFT contract address.
 * @param {boolean} [params.isLsp8] Standard hint when the caller holds a listing row;
 * omitted, the server infers it.
 * @param {boolean} [params.enabled=true] Skip fetching while inputs are incomplete.
 * @param {number} [params.bannerWidth=1600] Width hint for the banner image proxy.
 * @param {number} [params.iconWidth=128] Width hint for the icon image proxy.
 */
export default function useCollectionInfo({ chainId, collection, isLsp8, enabled = true, bannerWidth = 1600, iconWidth = 128 }) {
  const ready = Boolean(enabled && chainId && collection)

  const { data, error, isLoading, mutate } = useSWRImmutable(
    ready ? ['nft-collection-info', Number(chainId), collection.toLowerCase()] : null,
    () => getNftCollectionInfo(chainId, collection, typeof isLsp8 === 'boolean' ? isLsp8 : undefined),
  )

  const [isRefreshing, setIsRefreshing] = useState(false)

  // Re-reads the collection's identity (banner, description, links, supply) from chain and
  // writes the result straight into the SWR cache, so the header updates in place. Quiet by
  // design: a server-side throttle (60s per collection) or a transient failure returns null
  // rather than throwing — callers usually run this alongside the heavier token sweep, whose
  // toast carries the outcome.
  const refresh = useCallback(async () => {
    if (!ready || isRefreshing) return null
    setIsRefreshing(true)
    try {
      const response = await fetch(`/api/v1/nfts/collections/${Number(chainId)}/${collection.toLowerCase()}`, { method: 'POST' })
      const body = await response.json().catch(() => null)
      if (!response.ok || !body?.success) return null

      await mutate(body, { revalidate: false })
      return body.data
    } catch {
      return null
    } finally {
      setIsRefreshing(false)
    }
  }, [ready, isRefreshing, chainId, collection, mutate])

  const info = data?.data || null

  return {
    name: info?.name || null,
    symbol: info?.symbol || null,
    description: info?.description || null,
    // Icons render as thumbnails, so animated ones stay on their first frame; the banner
    // is the one place a collection's animation is worth playing.
    banner: info?.banner ? resolveStorageImageUrl(info.banner, { width: bannerWidth }) : null,
    icon: info?.icon ? resolveStorageImageUrl(info.icon, { width: iconWidth, still: true }) : null,
    creators: info?.creators || [],
    // [{title, url}] from LSP4Metadata links — title may be null, consumers fall back
    // to the URL's hostname
    links: info?.links || [],
    totalSupply: info?.totalSupply || null,
    isLsp8: typeof info?.isLsp8 === 'boolean' ? info.isLsp8 : null,
    source: info?.source || null,
    isLoading: ready && isLoading,
    error,
    // Re-reads the collection identity from chain, for a collection that changed onchain.
    refresh,
    isRefreshing,
  }
}

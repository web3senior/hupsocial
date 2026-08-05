'use client'

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

  const { data, error, isLoading } = useSWRImmutable(
    ready ? ['nft-collection-info', Number(chainId), collection.toLowerCase()] : null,
    () => getNftCollectionInfo(chainId, collection, typeof isLsp8 === 'boolean' ? isLsp8 : undefined),
  )

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
    totalSupply: info?.totalSupply || null,
    isLsp8: typeof info?.isLsp8 === 'boolean' ? info.isLsp8 : null,
    source: info?.source || null,
    isLoading: ready && isLoading,
    error,
  }
}

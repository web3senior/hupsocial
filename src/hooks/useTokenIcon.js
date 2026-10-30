'use client'

import useSWRImmutable from 'swr/immutable'
import { usePublicClient } from 'wagmi'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { LSP4_METADATA_KEY, erc725yGetDataAbi, decodeVerifiableUri, fetchMetadataJson, pickLsp4Icon } from '@/lib/lsp4'

/**
 * Resolves token artwork from LSP4Metadata or the shared indexed branding endpoint.
 * The first available source wins. Cached immutably per (chain, token) —
 * token branding is treated as static for the session.
 * Returns null while loading and for tokens without available artwork.
 * @param {Object} params
 * @param {number} params.chainId Chain the token lives on.
 * @param {string} params.token Token contract address.
 * @param {boolean} [params.enabled=true] Only fetch when the token is LSP7.
 * @param {number} [params.imageWidth=64] Width hint for the proxied image URL.
 */
export default function useTokenIcon({ chainId, token, enabled = true, imageWidth = 64 }) {
  const publicClient = usePublicClient({ chainId })
  const ready = Boolean(enabled && publicClient && token)

  const { data } = useSWRImmutable(ready ? ['token-icon', chainId, token.toLowerCase()] : null, async () => {
    const onchain = async () => {
      const bytes = await publicClient.readContract({ abi: erc725yGetDataAbi, address: token, functionName: 'getData', args: [LSP4_METADATA_KEY] })
      const json = await fetchMetadataJson(decodeVerifiableUri(bytes))
      return pickLsp4Icon(json?.LSP4Metadata || json)
    }
    const indexed = async () => {
      const response = await fetch(`/api/v1/tokens/info?${new URLSearchParams({ networkId: String(chainId), address: token })}`)
      if (!response.ok) throw new Error('Token branding unavailable')
      return (await response.json())?.data?.logo
    }
    // First usable artwork wins, including when the original IPFS document is unavailable.
    return Promise.any([onchain(), indexed()].map(async (result) => {
      const icon = await result
      if (!icon) throw new Error('Token artwork unavailable')
      return icon
    })).catch(() => null)
  })

  return data ? resolveStorageImageUrl(data, { width: imageWidth }) : null
}

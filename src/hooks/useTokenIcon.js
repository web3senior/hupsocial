'use client'

import useSWRImmutable from 'swr/immutable'
import { usePublicClient } from 'wagmi'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { LSP4_METADATA_KEY, erc725yGetDataAbi, decodeVerifiableUri, fetchMetadataJson, pickLsp4Icon } from '@/lib/lsp4'

/**
 * Resolves the onchain LSP4Metadata icon for an LSP7 token (ERC725Y getData →
 * VerifiableURI → metadata JSON → icon url). Cached immutably per (chain, token) —
 * token branding is treated as static for the session.
 * Returns null while loading, on plain ERC20s, and for tokens without an icon.
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
    const bytes = await publicClient
      .readContract({ abi: erc725yGetDataAbi, address: token, functionName: 'getData', args: [LSP4_METADATA_KEY] })
      .catch(() => null)
    const json = await fetchMetadataJson(decodeVerifiableUri(bytes)).catch(() => null)
    return pickLsp4Icon(json?.LSP4Metadata || json)
  })

  return data ? resolveStorageImageUrl(data, { width: imageWidth }) : null
}

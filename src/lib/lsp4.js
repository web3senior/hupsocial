// Shared LSP4 (LUKSO digital asset metadata) helpers — used by useNftMetadata for
// LSP8 collections and useTokenIcon for LSP7 payment tokens. Client-side only
// (fetchMetadataJson relies on browser fetch/atob).

import { hexToString } from 'viem'
import { resolveStorageUrl } from '@/lib/storageHelper'

// LSP4 metadata lives in ERC725Y storage — keccak256 data keys per the LSP4 spec
export const LSP4_TOKEN_NAME_KEY = '0xdeba1e292f8ba88238e10ab3c7f88bd4be4fac56cad5194b6ecceaf653468af1'
export const LSP4_METADATA_KEY = '0x9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e'

export const erc725yGetDataAbi = [
  {
    type: 'function',
    name: 'getData',
    stateMutability: 'view',
    inputs: [{ name: 'dataKey', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes' }],
  },
]

// A VerifiableURI (LSP2) is `0x0000` + bytes4 verification method + bytes2 hash length +
// hash + utf8 url. Rather than trusting every collection to encode it perfectly, decode the
// whole payload as text and pull the trailing url out of it.
export const decodeVerifiableUri = (bytes) => {
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
export const pickLsp4Image = (lsp4) => lsp4?.images?.[0]?.[0]?.url || lsp4?.icon?.[0]?.url || null

// For token avatars the square icon is the primary asset and images are the fallback.
export const pickLsp4Icon = (lsp4) => lsp4?.icon?.[0]?.url || lsp4?.images?.[0]?.[0]?.url || null

export const fetchMetadataJson = async (uri) => {
  if (!uri) return null
  if (uri.startsWith('data:application/json')) {
    const comma = uri.indexOf(',')
    // Only the header before the comma decides the encoding. Collections that embed their
    // artwork inline (Burnt Pix ships the whole SVG as `data:image/svg+xml;base64,…` inside
    // the JSON) would otherwise look base64 because of the *image's* marker, and atob would
    // choke on the plain-text body.
    const isBase64 = comma !== -1 && uri.slice(0, comma).includes(';base64')
    const payload = uri.slice(comma + 1)
    if (isBase64) return JSON.parse(atob(payload))
    // Percent-decoding is best effort — a body containing a bare `%` is not valid
    // percent-encoding but is still valid JSON.
    try {
      return JSON.parse(decodeURIComponent(payload))
    } catch {
      return JSON.parse(payload)
    }
  }
  const response = await fetch(resolveStorageUrl(uri))
  if (!response.ok) return null
  return response.json()
}

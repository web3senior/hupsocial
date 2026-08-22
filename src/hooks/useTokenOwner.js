'use client'

import { useConnection, useReadContract } from 'wagmi'
import { zeroAddress } from 'viem'
import { nftOwnerAbi } from '@/lib/nftMetadata'
import { normalizeTokenId } from '@/lib/walletNfts'

/**
 * Who holds one token, read from the collection itself.
 *
 * Straight from chain rather than from a listing row, because a listing is not custody:
 * HupTrade is non-custodial (see the contract's header), so a listed NFT never leaves its
 * owner's wallet, and an indexed seller is only who listed it — not necessarily who holds it
 * now. Ownership is also the one question ERC721 and LSP8 answer identically, which is why
 * `tokenExists` leans on it too.
 *
 * `isOwner` is what gates every owner-only action in the detail panel (List, Transfer, accepting
 * an offer). It stays false while the read is in flight — showing the controls first and
 * retracting them a beat later is worse than showing them a beat late.
 * @param {Object} params
 * @param {number|string} params.chainId Chain the collection lives on.
 * @param {string} params.collection NFT contract address.
 * @param {string} params.tokenId Raw token id — bytes32 hex for LSP8, decimal for ERC721.
 * @param {boolean} params.isLsp8 True for LSP8 collections.
 * @param {boolean} [params.enabled=true] Skip the read while inputs are incomplete.
 * @returns {{owner: string|null, isOwner: boolean, isLoading: boolean, refetch: Function}}
 */
export default function useTokenOwner({ chainId, collection, tokenId, isLsp8, enabled = true }) {
  const { address } = useConnection()

  // LSP8 takes the padded bytes32; ERC721 takes the number. A caller holding the other dialect
  // (the collection grid stores bytes32 for both) would otherwise revert the read.
  let args = null
  try {
    if (tokenId !== undefined && tokenId !== null && tokenId !== '') {
      args = isLsp8 ? [normalizeTokenId(tokenId)] : [BigInt(tokenId)]
    }
  } catch {
    // An id that is neither a number nor hex can't be asked about — the read stays disabled
    args = null
  }

  const ready = Boolean(enabled && chainId && collection && args?.[0] !== null && args?.[0] !== undefined)

  const { data, isLoading, refetch } = useReadContract({
    abi: nftOwnerAbi,
    address: collection,
    functionName: isLsp8 ? 'tokenOwnerOf' : 'ownerOf',
    args: args || undefined,
    chainId: Number(chainId),
    query: { enabled: ready },
  })

  // An ERC721 that answers with the zero address instead of reverting is saying the same thing
  // a revert does: nobody holds this id
  const owner = data && data !== zeroAddress ? data : null

  return {
    owner,
    isOwner: Boolean(address && owner && address.toLowerCase() === owner.toLowerCase()),
    isLoading: ready && isLoading,
    refetch,
  }
}

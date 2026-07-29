'use client'

import useSWR from 'swr'
import { usePublicClient } from 'wagmi'
import { batchReadContracts } from '@/lib/nftInventory'

// Enough to pick from without turning the modal into a gallery — anything past this the
// seller pastes by hand, and the caller says so rather than silently truncating
const MAX_TOKEN_IDS = 24

// LSP8 enumerates a holder's tokens in one call, so LUKSO collections always answer
const lsp8Abi = [
  {
    type: 'function',
    name: 'tokenIdsOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenOwner', type: 'address' }],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
]

// balanceOf is required by ERC721; tokenOfOwnerByIndex is the optional Enumerable extension,
// so a collection can answer the first and revert on the second
const erc721EnumerableAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'tokenOfOwnerByIndex',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'index', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
]

const fetchOwnedTokenIds = async ({ publicClient, collection, owner, isLsp8 }) => {
  if (isLsp8) {
    const ids = await publicClient.readContract({
      abi: lsp8Abi,
      address: collection,
      functionName: 'tokenIdsOf',
      args: [owner],
    })
    return { tokenIds: [...ids].slice(0, MAX_TOKEN_IDS), balance: ids.length, isEnumerable: true }
  }

  const balance = await publicClient
    .readContract({ abi: erc721EnumerableAbi, address: collection, functionName: 'balanceOf', args: [owner] })
    .catch(() => null)
  // Not an ERC721 at all (or an unreachable contract) — no count to report, no list to offer
  if (balance === null) return { tokenIds: [], balance: null, isEnumerable: false }

  const count = Number(balance)
  if (count === 0) return { tokenIds: [], balance: 0, isEnumerable: true }

  const results = await batchReadContracts(
    publicClient,
    Array.from({ length: Math.min(count, MAX_TOKEN_IDS) }, (_, index) => ({
      abi: erc721EnumerableAbi,
      address: collection,
      functionName: 'tokenOfOwnerByIndex',
      args: [owner, BigInt(index)],
    })),
  )

  // ERC721Enumerable is optional: a collection that skips it holds a real balance but reverts
  // on every index, which is the signal to fall back to typing the id in
  const tokenIds = results.filter((entry) => entry.status === 'success').map((entry) => entry.result.toString())
  return { tokenIds, balance: count, isEnumerable: tokenIds.length > 0 }
}

/**
 * The token ids a wallet owns inside one collection, read live onchain so it stays right on
 * every chain — there is no wallet index outside LUKSO, and even there the chain is the
 * authority on what can actually be listed.
 *
 * Ids come back in the form each standard speaks: bytes32 hex for LSP8, decimal for ERC721.
 * Both are what normalizeTokenId in the sell modal expects.
 *
 * @param {Object} params
 * @param {number} params.chainId Chain the collection lives on.
 * @param {string|null} params.collection NFT contract address.
 * @param {string|null} params.owner Wallet whose tokens to list.
 * @param {boolean} params.isLsp8 True for LSP8 collections, false for ERC721.
 * @param {boolean} [params.enabled=true] Skip while inputs are incomplete.
 * @returns {{tokenIds: string[], balance: number|null, isEnumerable: boolean, isLoading: boolean}}
 * `balance` is how many the wallet holds in total (null when the contract can't say), which is
 * how callers tell "owns nothing here" from "owns some but the collection won't enumerate them".
 */
export default function useOwnedTokenIds({ chainId, collection, owner, isLsp8, enabled = true }) {
  const publicClient = usePublicClient({ chainId })
  const ready = Boolean(enabled && publicClient && collection && owner)

  const { data, isLoading } = useSWR(
    ready ? ['owned-token-ids', chainId, collection.toLowerCase(), owner.toLowerCase(), Boolean(isLsp8)] : null,
    () => fetchOwnedTokenIds({ publicClient, collection, owner, isLsp8 }),
    // Ownership can change under the user, but not while a modal is open — refetching on every
    // window focus would re-run a multicall for no gain
    { revalidateOnFocus: false },
  )

  return {
    tokenIds: data?.tokenIds || [],
    balance: data?.balance ?? null,
    isEnumerable: data?.isEnumerable ?? false,
    isLoading: ready && isLoading,
  }
}

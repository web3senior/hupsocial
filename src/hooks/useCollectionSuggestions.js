'use client'

import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { usePublicClient } from 'wagmi'
import { hexToString, isAddress } from 'viem'
import { getNftCollections } from '@/lib/api'
import { LSP4_TOKEN_NAME_KEY } from '@/lib/lsp4'
import { batchReadContracts, fetchWalletCollections, searchNftCollections, supportsWalletScan } from '@/lib/nftInventory'

const MARKET_LIMIT = 12
const MAX_SUGGESTIONS = 12
const SEARCH_DEBOUNCE_MS = 350

const erc721Abi = [
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
]

// LSP8 has no name() — the collection name lives in ERC725Y storage under LSP4TokenName
const erc725yAbi = [
  {
    type: 'function',
    name: 'getData',
    stateMutability: 'view',
    inputs: [{ name: 'dataKey', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes' }],
  },
]

const decodeLsp4Name = (bytes) => {
  if (!bytes || bytes === '0x') return null
  try {
    return hexToString(bytes).trim() || null
  } catch {
    return null
  }
}

/**
 * Collections with live HupTrade listings, named and ownership-probed onchain.
 *
 * Neither piece is indexed: the collections endpoint documents that names and artwork aren't
 * stored server-side, and nft_listings only knows sellers, not holders. Both come back in one
 * batched read — the closest thing to a wallet scan on the chains that have no wallet index.
 */
async function fetchMarketCollections({ publicClient, chainId, isLsp8, owner }) {
  const json = await getNftCollections(MARKET_LIMIT, chainId).catch(() => null)
  const rows = (json?.data || []).filter((row) => Boolean(Number(row.is_lsp8)) === Boolean(isLsp8))
  if (rows.length === 0) return []

  const addresses = rows.map((row) => row.collection)
  const nameCalls = addresses.map((address) =>
    isLsp8
      ? { abi: erc725yAbi, address, functionName: 'getData', args: [LSP4_TOKEN_NAME_KEY] }
      : { abi: erc721Abi, address, functionName: 'name' },
  )
  // balanceOf has the same selector and shape on ERC721 and LSP8, so one probe covers both
  const balanceCalls = owner
    ? addresses.map((address) => ({ abi: erc721Abi, address, functionName: 'balanceOf', args: [owner] }))
    : []

  const results = await batchReadContracts(publicClient, [...nameCalls, ...balanceCalls])
  const names = results.slice(0, addresses.length)
  const balances = results.slice(addresses.length)

  return rows.map((row, index) => {
    const nameResult = names[index]?.status === 'success' ? names[index].result : null
    const balanceResult = balances[index]?.status === 'success' ? balances[index].result : null
    return {
      address: row.collection,
      name: (isLsp8 ? decodeLsp4Name(nameResult) : nameResult) || null,
      symbol: null,
      image: null,
      ownedCount: balanceResult === null ? 0 : Number(balanceResult),
      activeCount: Number(row.active_count) || 0,
    }
  })
}

// Later sources only fill gaps — a wallet-scanned collection keeps its own owned count and
// artwork when the market rollup or a name search turns up the same address
const mergeInto = (map, entry) => {
  const key = entry.address.toLowerCase()
  const existing = map.get(key)
  if (!existing) {
    map.set(key, { ownedCount: 0, activeCount: 0, holderCount: null, ...entry })
    return
  }
  existing.name = existing.name || entry.name || null
  existing.symbol = existing.symbol || entry.symbol || null
  existing.image = existing.image || entry.image || null
  existing.ownedCount = Math.max(existing.ownedCount, entry.ownedCount || 0)
  existing.activeCount = Math.max(existing.activeCount, entry.activeCount || 0)
  existing.holderCount = existing.holderCount ?? entry.holderCount ?? null
}

/**
 * Ranked collection suggestions for the sell modal's collection field, merged from every source
 * the chain offers: the wallet's own holdings (LUKSO only — no other chain has a wallet index),
 * the collections currently trading on Hup, and a name search.
 *
 * Entries carry a `group` so the picker can head them honestly: 'owned' means proven onchain
 * ownership, 'market' means listed on Hup, 'search' means a name match and nothing more.
 *
 * @param {Object} params
 * @param {number} params.chainId Chain to suggest collections from.
 * @param {string|null} params.owner Connected wallet, or null when disconnected.
 * @param {boolean} params.isLsp8 Restricts suggestions to the standard being listed.
 * @param {string} params.query Whatever is typed in the field.
 * @returns {{suggestions: Array<Object>, isLoading: boolean, canScanWallet: boolean}}
 */
export default function useCollectionSuggestions({ chainId, owner, isLsp8, query }) {
  const publicClient = usePublicClient({ chainId })
  const canScanWallet = supportsWalletScan(chainId) && Boolean(isLsp8)
  const trimmedQuery = query.trim()

  const { data: walletCollections, isLoading: walletLoading } = useSWR(
    owner && canScanWallet ? ['wallet-nft-collections', chainId, owner.toLowerCase()] : null,
    () => fetchWalletCollections(chainId, owner),
    { revalidateOnFocus: false },
  )

  const { data: marketCollections, isLoading: marketLoading } = useSWR(
    publicClient && chainId ? ['market-nft-collections', chainId, Boolean(isLsp8), owner?.toLowerCase() ?? null] : null,
    () => fetchMarketCollections({ publicClient, chainId, isLsp8, owner }),
    { revalidateOnFocus: false },
  )

  // A pasted address is already the answer — searching on it would only add noise
  const [debouncedQuery, setDebouncedQuery] = useState('')
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(trimmedQuery), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timeout)
  }, [trimmedQuery])

  const shouldSearch = canScanWallet && debouncedQuery.length >= 2 && !isAddress(debouncedQuery)
  const { data: searchResults } = useSWR(
    shouldSearch ? ['nft-collection-search', chainId, debouncedQuery] : null,
    () => searchNftCollections(chainId, debouncedQuery),
    { revalidateOnFocus: false },
  )

  const suggestions = useMemo(() => {
    const merged = new Map()
    ;(walletCollections || []).forEach((entry) => mergeInto(merged, entry))
    ;(marketCollections || []).forEach((entry) => mergeInto(merged, entry))
    ;(searchResults || []).forEach((entry) => mergeInto(merged, entry))

    const needle = trimmedQuery.toLowerCase()
    return [...merged.values()]
      .filter((entry) => {
        if (!needle) return true
        return (
          entry.address.toLowerCase().includes(needle) ||
          (entry.name || '').toLowerCase().includes(needle) ||
          (entry.symbol || '').toLowerCase().includes(needle)
        )
      })
      .map((entry) => ({
        ...entry,
        group: entry.ownedCount > 0 ? 'owned' : entry.activeCount > 0 ? 'market' : 'search',
      }))
      .sort(
        (a, b) =>
          b.ownedCount - a.ownedCount ||
          b.activeCount - a.activeCount ||
          (b.holderCount ?? 0) - (a.holderCount ?? 0) ||
          (a.name || a.address).localeCompare(b.name || b.address),
      )
      .slice(0, MAX_SUGGESTIONS)
  }, [walletCollections, marketCollections, searchResults, trimmedQuery])

  return { suggestions, isLoading: Boolean(walletLoading || marketLoading), canScanWallet }
}

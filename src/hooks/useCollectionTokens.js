'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { batchReadContracts } from '@/lib/nftInventory'
import { getNftCollectionTokens } from '@/lib/api'

const PAGE_SIZE = 24

// totalSupply + tokenByIndex are the ERC721Enumerable extension — optional, so either read
// can revert on a collection that skipped it, which is the signal to fall back to the cache
const erc721EnumerableAbi = [
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'tokenByIndex',
    stateMutability: 'view',
    inputs: [{ name: 'index', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
]

/**
 * Every token in one collection, paged, from the best source the collection allows:
 *
 * - `chain` — ERC721Enumerable collections enumerate themselves: totalSupply + tokenByIndex,
 *   read live in one multicall per page. Complete by construction, burns included-out.
 * - `cache` — everything else (LSP8 has no global token index; plain ERC721 can't enumerate
 *   either): the tokens this app has seen, from nft_metadata_cache via the tokens API. Grows
 *   as the collection is listed, traded and browsed, and `total` counts only what's cached,
 *   so the caller can present coverage honestly.
 *
 * Rows share one shape either way: `{token_id, is_lsp8, listing}` — chain-mode rows carry a
 * null listing, and the caller overlays live listings itself.
 *
 * @param {Object} params
 * @param {number} params.chainId Chain the collection lives on.
 * @param {string|null} params.collection NFT contract address.
 * @param {boolean|null} params.isLsp8 The collection's standard; null while it still resolves.
 * @param {boolean} [params.enabled=true] Skip while inputs are incomplete or the view is hidden.
 * @returns {{mode: 'chain'|'cache'|null, tokens: Array<Object>, total: number|null,
 * hasMore: boolean, isLoading: boolean, isFetchingMore: boolean, loadMore: Function}}
 */
export default function useCollectionTokens({ chainId, collection, isLsp8, enabled = true }) {
  const publicClient = usePublicClient({ chainId })
  const ready = Boolean(enabled && collection && typeof isLsp8 === 'boolean')

  const [mode, setMode] = useState(null)
  const [tokens, setTokens] = useState([])
  const [total, setTotal] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isFetchingMore, setIsFetchingMore] = useState(false)

  // One counter guards every await in the file: a response belonging to a superseded run
  // (range change, unmount, re-enable) is dropped instead of racing the current one
  const runRef = useRef(0)
  // chain mode: the supply and how far into the index the grid has asked; cache mode: the page
  const supplyRef = useRef(0)
  const indexRef = useRef(0)
  const pageRef = useRef(1)

  const readIndexSlice = useCallback(
    async (offset, count) => {
      const end = Math.min(offset + PAGE_SIZE, count)
      const results = await batchReadContracts(
        publicClient,
        Array.from({ length: end - offset }, (_, i) => ({
          abi: erc721EnumerableAbi,
          address: collection,
          functionName: 'tokenByIndex',
          args: [BigInt(offset + i)],
        })),
      )

      return {
        end,
        tokens: results
          .filter((entry) => entry.status === 'success')
          .map((entry) => ({ token_id: entry.result.toString(), is_lsp8: false, listing: null })),
      }
    },
    [publicClient, collection],
  )

  useEffect(() => {
    if (!ready) return
    const run = ++runRef.current

    const load = async () => {
      setIsLoading(true)
      setMode(null)
      setTokens([])

      // Chain enumeration is only a thing ERC721 can offer
      if (isLsp8 === false && publicClient) {
        try {
          const supply = await publicClient.readContract({
            abi: erc721EnumerableAbi,
            address: collection,
            functionName: 'totalSupply',
          })
          if (run !== runRef.current) return

          const count = Number(supply)
          const slice = count > 0 ? await readIndexSlice(0, count) : { end: 0, tokens: [] }
          if (run !== runRef.current) return

          // A supply with nothing enumerable means the collection answered totalSupply but
          // skipped tokenByIndex — not our page to build from, fall through to the cache
          if (count === 0 || slice.tokens.length > 0) {
            supplyRef.current = count
            indexRef.current = slice.end
            setMode('chain')
            setTokens(slice.tokens)
            setTotal(count)
            setHasMore(slice.end < count)
            setIsLoading(false)
            return
          }
        } catch {
          // totalSupply reverted — not enumerable, the cache is the best remaining answer
        }
        if (run !== runRef.current) return
      }

      try {
        const res = await getNftCollectionTokens(chainId, collection, 1, PAGE_SIZE)
        if (run !== runRef.current) return
        pageRef.current = 1
        setMode('cache')
        setTokens(res.data || [])
        setTotal(res.meta?.total ?? 0)
        setHasMore(res.meta?.hasMore || false)
      } catch {
        if (run !== runRef.current) return
        setMode('cache')
        setTokens([])
        setTotal(0)
        setHasMore(false)
      } finally {
        if (run === runRef.current) setIsLoading(false)
      }
    }
    load()

    return () => {
      // Invalidate in cleanup too, so a response landing after unmount is dropped
      runRef.current += 1
    }
  }, [ready, chainId, collection, isLsp8, publicClient, readIndexSlice])

  const loadMore = useCallback(async () => {
    if (isFetchingMore || isLoading || !hasMore || !mode) return
    const run = runRef.current
    setIsFetchingMore(true)

    try {
      if (mode === 'chain') {
        const slice = await readIndexSlice(indexRef.current, supplyRef.current)
        if (run !== runRef.current) return
        indexRef.current = slice.end
        setTokens((prev) => [...prev, ...slice.tokens])
        setHasMore(slice.end < supplyRef.current)
      } else {
        const nextPage = pageRef.current + 1
        const res = await getNftCollectionTokens(chainId, collection, nextPage, PAGE_SIZE)
        if (run !== runRef.current) return
        pageRef.current = nextPage
        setTokens((prev) => [...prev, ...(res.data || [])])
        setHasMore(res.meta?.hasMore || false)
      }
    } catch {
      // A retry click picks it back up — same rule as every other load-more in the app
    } finally {
      if (run === runRef.current) setIsFetchingMore(false)
    }
  }, [isFetchingMore, isLoading, hasMore, mode, chainId, collection, readIndexSlice])

  return { mode, tokens, total, hasMore, isLoading: ready && isLoading, isFetchingMore, loadMore }
}

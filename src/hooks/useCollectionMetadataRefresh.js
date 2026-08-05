'use client'

import { useCallback, useRef, useState } from 'react'
import { useSWRConfig } from 'swr'
import { refreshNftCollectionMetadata } from '@/lib/api'

// The endpoint answers with a bounded batch, so a large collection takes several calls. This
// caps how many the client will chain — enough for the collections the market actually holds,
// and a hard stop on a tab sweeping indefinitely if the server kept reporting work left.
const MAX_ROUNDS = 25

/**
 * Whole-collection version of useNftMetadata's `refresh`, for a collection that changed its
 * onchain metadata across every token rather than one of them.
 *
 * Drives the chunked endpoint to completion and then drops the collection's entries from SWR,
 * which is the half that matters on screen: the server rows are fresh the moment the sweep
 * ends, but every card reads through an immutable SWR key that has no idea anything changed,
 * so without this the tiles would keep painting the old artwork until a reload.
 *
 * @param {Object} params
 * @param {number|string} params.chainId Chain the collection lives on.
 * @param {string} params.collection NFT contract address.
 * @returns {{refresh: Function, isRefreshing: boolean, progress: {done: number, total: number}|null}}
 * `refresh` resolves to {total, done, failed, remaining} — `total` is how many tokens of this
 * collection are cached, `done` how many this run re-read. It resolves to null when the inputs
 * are incomplete or a sweep is already running.
 */
export default function useCollectionMetadataRefresh({ chainId, collection }) {
  const { mutate } = useSWRConfig()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [progress, setProgress] = useState(null)

  // The button's disabled state is derived from React state, which lags a double click by a
  // render — this is what actually keeps two sweeps from overlapping.
  const isRunningRef = useRef(false)

  const refresh = useCallback(async () => {
    if (!chainId || !collection || isRunningRef.current) return null
    isRunningRef.current = true
    setIsRefreshing(true)
    setProgress(null)

    try {
      let done = 0
      let failed = 0
      let summary = null

      for (let round = 0; round < MAX_ROUNDS; round++) {
        const result = await refreshNftCollectionMetadata(chainId, collection)
        summary = result
        done += result.processed
        failed += result.failed
        setProgress({ done, total: done + result.remaining })
        // A batch that processed nothing means the cooldown holds every remaining row — there
        // is no point spinning through the rest of the rounds to be told the same thing.
        if (result.processed === 0 || result.remaining === 0) break
      }

      const address = String(collection).toLowerCase()
      await mutate(
        (key) => Array.isArray(key) && key[0] === 'nft-metadata' && Number(key[1]) === Number(chainId) && key[2] === address,
      )

      return { total: summary?.total ?? 0, done, failed, remaining: summary?.remaining ?? 0 }
    } finally {
      isRunningRef.current = false
      setIsRefreshing(false)
    }
  }, [chainId, collection, mutate])

  return { refresh, isRefreshing, progress }
}

/**
 * Turns a completed sweep into the sentence the user sees, so every surface offering this
 * action describes the same outcome the same way.
 * @param {Object} result What `refresh` resolved to.
 * @returns {[string, string]} Message and NextToast tone.
 */
export const describeCollectionRefresh = (result) => {
  if (result.total === 0) return ['Nothing is cached for this collection yet — its NFTs read straight from chain', 'success']
  if (result.done === 0) return ['This collection was refreshed a moment ago', 'error']

  const noun = result.done === 1 ? 'NFT' : 'NFTs'
  if (result.remaining > 0) return [`Refreshed ${result.done} ${noun} — ${result.remaining} still to go`, 'success']

  return [`Refreshed ${result.done} ${noun} in this collection`, 'success']
}

/** Button label for a sweep in flight, counting up as batches land. */
export const collectionRefreshLabel = (progress) => (progress?.total ? `Refreshing ${progress.done}/${progress.total}…` : 'Refreshing…')

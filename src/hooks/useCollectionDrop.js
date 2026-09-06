'use client'

import { useReadContract } from 'wagmi'
import { isAddress } from 'viem'
import { CONTRACTS } from '@/config/wagmi'
import dropsAbi from '@/abis/HupDrops.json'
import { DROP_RECORD_ABI } from '@/lib/drops'

/**
 * useCollectionDrop
 * Whether a collection was launched through HupDrops and, if so, its live drop record. The
 * engine keeps a reverse index — `dropIdOf(collection)`, 0 for anything it never deployed —
 * so a collection page asks the chain directly: no creator hint, no cidex row, and a drop the
 * indexer has not caught up with yet still shows. Live state (minted, closed, phases) comes
 * from the same reads DropCard makes, so wagmi serves both from one cache entry.
 * @param {Object} params
 * @param {number} params.chainId Chain the collection lives on.
 * @param {string} params.collection Collection contract address.
 * @returns {{ dropsAddress: string|null, dropId: string|null, drop: Object|null, phases: Array,
 *   isLoading: boolean, refetch: Function }}
 */
export default function useCollectionDrop({ chainId, collection }) {
  const dropsAddress = CONTRACTS[`chain${chainId}`]?.drops || null
  const enabled = Boolean(dropsAddress && collection && isAddress(collection))

  const { data: dropIdRaw, isLoading: isLookingUp } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress ?? undefined,
    functionName: 'dropIdOf',
    args: [collection],
    chainId,
    query: { enabled },
  })
  const dropId = typeof dropIdRaw === 'bigint' && dropIdRaw > 0n ? dropIdRaw : null

  const { data: drop, isLoading: isLoadingDrop, refetch } = useReadContract({
    abi: DROP_RECORD_ABI,
    address: dropsAddress ?? undefined,
    functionName: 'getDrop',
    args: [dropId ?? 0n],
    chainId,
    query: { enabled: Boolean(dropId) },
  })

  const { data: phases = [] } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress ?? undefined,
    functionName: 'phasesOf',
    args: [dropId ?? 0n],
    chainId,
    query: { enabled: Boolean(dropId) },
  })

  return {
    dropsAddress,
    dropId: dropId ? dropId.toString() : null,
    drop: drop ?? null,
    phases,
    isLoading: enabled && (isLookingUp || (Boolean(dropId) && isLoadingDrop)),
    refetch,
  }
}

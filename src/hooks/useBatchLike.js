'use client'

/**
 * @file hooks/useBatchLike.js
 * @description Reads the connected wallet's like basket, grouped per chain, and sends one
 * chain's queue as a batchLike. Every basket surface (the floating heart, the mobile tab)
 * shares this so the send logic lives in exactly one place.
 *
 * One chain per transaction is a hard constraint, not a design choice: batchLike runs on a
 * single Hup contract, and the wallet has to be connected to that chain to sign for it.
 */

import { useCallback, useMemo, useState } from 'react'
import { useChainId, useConfig, useConnection, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { getPublicClient } from 'wagmi/actions'
import abi from '@/abi/post.json'
import { CONTRACTS } from '@/config/wagmi'
import { getNetworkDisplayName } from '@/lib/chains'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { MAX_BATCH_LIKE_COUNT, chunk, describeDropped, preflightQueue } from '@/lib/batchLike'
import { getWalletBatchMap, useSidebarStore } from '@/stores/useSidebarStore'
import { toast } from '@/components/NextToast'
import { shortTxError } from '@/lib/utils'

export const useBatchLike = () => {
  const config = useConfig()
  const { address, isConnected } = useConnection()
  // Reactive, unlike a render-time chain snapshot: the value is read again after
  // switchChainAsync resolves
  const walletChainId = useChainId()
  const publicClient = usePublicClient()
  const { switchChainAsync } = useSwitchChain()
  const { mutateAsync: writeContractAsync } = useWriteContract()

  const likedPostIdsMap = useSidebarStore((state) => state.likedPostIds ?? {})
  const removeFromBatch = useSidebarStore((state) => state.removeFromBatch)
  const clearBatch = useSidebarStore((state) => state.clearBatch)
  const markLikeOverride = useSidebarStore((state) => state.markLikeOverride)

  // Which chain is mid-send, so a surface can spin the right row
  const [pendingNetworkId, setPendingNetworkId] = useState(null)

  // Only the connected wallet's own basket, one entry per chain that still holds something
  const groups = useMemo(() => {
    const walletQueueMap = getWalletBatchMap(likedPostIdsMap, address)

    return Object.entries(walletQueueMap)
      .filter(([, ids]) => Array.isArray(ids) && ids.length > 0)
      .map(([networkId, ids]) => ({
        networkId,
        ids,
        count: ids.length,
        name: getNetworkDisplayName(config, networkId),
      }))
  }, [likedPostIdsMap, address, config])

  const total = useMemo(() => groups.reduce((sum, group) => sum + group.count, 0), [groups])

  const send = useCallback(
    async (networkId) => {
      if (!isConnected || !address) {
        toast('Please connect your wallet first', 'error')
        return
      }

      const group = groups.find((entry) => entry.networkId === String(networkId))
      if (!group) {
        toast('No queued interactions found for this network', 'error')
        return
      }

      const numericChainId = Number(networkId)
      const targetChain = CONTRACTS[`chain${networkId}`]
      if (!targetChain?.hup) {
        toast('Contract configuration missing for network', 'error')
        return
      }

      const chainDefinition = config.chains.find((item) => item.id === numericChainId)
      if (!chainDefinition) {
        toast('Queued network is not configured', 'error')
        return
      }

      // The queued network is not necessarily the connected one, so reads go through a
      // client pinned to the basket's own chain
      const targetPublicClient = getPublicClient(config, { chainId: numericChainId }) ?? publicClient

      try {
        setPendingNetworkId(String(networkId))

        if (walletChainId !== numericChainId) {
          toast('Switching network to match the basket...', 'info')
          await switchChainAsync({ chainId: numericChainId })
        }

        let queue = group.ids
        let dropped = []

        if (targetPublicClient) {
          try {
            const result = await preflightQueue({
              client: targetPublicClient,
              contractAddress: targetChain.hup,
              ids: group.ids,
              viewer: address,
            })

            queue = result.likeable
            dropped = result.dropped
          } catch (err) {
            // A failed read is no reason to block the batch; the size cap below
            // still applies and the wallet surfaces anything left
            console.error('Batch like preflight failed:', err)
            toast('Could not verify basket, sending as staged', 'info')
          }
        }

        // These ids revert forever, and one of them takes the whole array down
        if (dropped.length > 0) {
          dropped.forEach((entry) => removeFromBatch(address, networkId, entry.id))
          toast(`Skipped ${describeDropped(dropped)}`, 'info')
        }

        if (queue.length === 0) {
          toast('Nothing left to like here', 'info')
          return
        }

        const session = await isSessionActive({
          userAddress: address,
          publicClient: targetPublicClient ?? publicClient,
        })

        const batches = chunk(queue, MAX_BATCH_LIKE_COUNT)

        for (let index = 0; index < batches.length; index++) {
          const batch = batches[index]

          if (batches.length > 1) toast(`Signing batch ${index + 1} of ${batches.length}`, 'info')

          if (session.active) {
            // Burner key authorization route needs no wallet confirmation
            await writeWithBurnerSession({
              chain: chainDefinition,
              contractAddress: targetChain.hup,
              abi,
              functionName: 'batchLike',
              args: [address, batch],
            })
          } else {
            await writeContractAsync({
              abi,
              chainId: numericChainId,
              address: targetChain.hup,
              functionName: 'batchLike',
              args: [address, batch],
            })
          }

          // Flag every signed post as liked so feed hearts turn red immediately instead of
          // waiting for the indexer plus a manual refresh. Clearing per batch keeps the
          // unsigned remainder queued if a later one fails.
          markLikeOverride(address, networkId, batch, true)
          batch.forEach((id) => removeFromBatch(address, networkId, id))
        }

        toast(session.active ? 'Liked via active session key!' : 'Batch like sent!', 'success')
      } catch (err) {
        console.error('Batch like transaction failed:', err)
        toast(shortTxError(err, 'Batch like failed'), 'error')
      } finally {
        setPendingNetworkId(null)
      }
    },
    [address, config, groups, isConnected, markLikeOverride, publicClient, removeFromBatch, switchChainAsync, walletChainId, writeContractAsync],
  )

  const clear = useCallback((networkId) => clearBatch(address, networkId), [address, clearBatch])

  return {
    total,
    groups,
    pendingNetworkId,
    isProcessing: pendingNetworkId !== null,
    send,
    clear,
  }
}

export default useBatchLike

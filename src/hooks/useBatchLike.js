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
import { useChainId, useConfig, useConnection, usePublicClient, useSignTypedData, useSwitchChain, useWriteContract } from 'wagmi'
import { getPublicClient } from 'wagmi/actions'
import abi from '@/abi/post.json'
import { CONTRACTS } from '@/config/wagmi'
import { MAX_SOLANA_BATCH_LIKE, isSolanaNetworkId } from '@/config/solana'
import { useSolanaWallet } from '@/hooks/useSolanaWallet'
import { hupInstruction } from '@/lib/solana/hup'
import { sendHupAction } from '@/lib/solana/relay'
import { getNetworkDisplayName } from '@/lib/chains'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { gaslessCooldown, isGaslessEnabled, relayHupAction } from '@/lib/relayGasless'
import { MAX_BATCH_LIKE_COUNT, chunk, describeDropped, preflightQueue } from '@/lib/batchLike'
import { getWalletBatchMap, useSidebarStore } from '@/stores/useSidebarStore'
import { toast } from '@/components/NextToast'
import { shortTxError } from '@/lib/utils'

export const useBatchLike = () => {
  const config = useConfig()
  const { address, isConnected } = useConnection()
  // Solana clusters queue under the Solana wallet, EVM chains under the EVM one
  const solanaWallet = useSolanaWallet()
  const solanaAddress = solanaWallet.address
  const ownerFor = (networkId) => (isSolanaNetworkId(networkId) ? solanaAddress : address)
  // Reactive, unlike a render-time chain snapshot: the value is read again after
  // switchChainAsync resolves
  const walletChainId = useChainId()
  const publicClient = usePublicClient()
  const { switchChainAsync } = useSwitchChain()
  const { mutateAsync: writeContractAsync } = useWriteContract()
  const { signTypedDataAsync } = useSignTypedData()

  const likedPostIdsMap = useSidebarStore((state) => state.likedPostIds ?? {})
  const removeFromBatch = useSidebarStore((state) => state.removeFromBatch)
  const clearBatch = useSidebarStore((state) => state.clearBatch)
  const markLikeOverride = useSidebarStore((state) => state.markLikeOverride)

  // Which chain is mid-send, so a surface can spin the right row
  const [pendingNetworkId, setPendingNetworkId] = useState(null)

  // Only the connected wallet's own basket, one entry per chain that still holds something
  const groups = useMemo(() => {
    // Two baskets, one per wallet — a chain only ever appears in one of them
    const walletQueueMap = {
      ...getWalletBatchMap(likedPostIdsMap, address),
      ...(solanaAddress ? getWalletBatchMap(likedPostIdsMap, solanaAddress) : {}),
    }

    return Object.entries(walletQueueMap)
      .filter(([, ids]) => Array.isArray(ids) && ids.length > 0)
      .map(([networkId, ids]) => ({
        networkId,
        ids,
        count: ids.length,
        name: getNetworkDisplayName(config, networkId),
      }))
  }, [likedPostIdsMap, address, solanaAddress, config])

  const total = useMemo(() => groups.reduce((sum, group) => sum + group.count, 0), [groups])

  // Solana has no batchLike: the basket goes out as several `like` instructions per
  // transaction, sponsored where the relay serves the cluster. No preflight either — the
  // program accepts any existing id and the indexer de-duplicates, so nothing here reverts.
  const sendSolanaBatch = async (group) => {
    const networkId = Number(group.networkId)
    const signer = solanaWallet.getSigner()
    if (!signer) {
      toast('Connect your Solana wallet first', 'error')
      return
    }
    const actor = signer.account.address

    try {
      setPendingNetworkId(String(group.networkId))
      const batches = chunk(group.ids, MAX_SOLANA_BATCH_LIKE)
      let sponsoredCount = 0

      for (let index = 0; index < batches.length; index++) {
        const batch = batches[index]
        if (batches.length > 1) toast(`Signing batch ${index + 1} of ${batches.length}`, 'info')

        const { sponsored } = await sendHupAction({
          networkId,
          signer,
          instructions: batch.map((id) => hupInstruction.like({ networkId, actor, id })),
        })
        if (sponsored) sponsoredCount++

        // Same as the EVM path: flag every signed post as liked right away, clear per batch
        markLikeOverride(actor, group.networkId, batch, true)
        batch.forEach((id) => removeFromBatch(actor, group.networkId, id))
      }

      const likedLabel = group.ids.length === 1 ? 'Post Liked' : 'Posts Liked'
      toast(sponsoredCount === batches.length ? `${likedLabel} — gas covered by Hup!` : likedLabel, 'success')
    } catch (err) {
      console.error('Solana batch like failed:', err)
      toast(shortTxError(err, 'Batch like failed'), 'error')
    } finally {
      setPendingNetworkId(null)
    }
  }

  const send = useCallback(
    async (networkId) => {
      const group = groups.find((entry) => entry.networkId === String(networkId))
      if (!group) {
        toast('No queued interactions found for this network', 'error')
        return
      }

      if (isSolanaNetworkId(networkId)) {
        await sendSolanaBatch(group)
        return
      }

      if (!isConnected || !address) {
        toast('Please connect your wallet first', 'error')
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

      // Only the wallet write path needs the wallet on the basket's chain — the relay and
      // the burner session both sign locally against the pinned chain definition. Switching
      // lazily means a fully sponsored send never opens a network-switch prompt at all.
      let walletOnTargetChain = walletChainId === numericChainId

      const ensureWalletChain = async () => {
        if (walletOnTargetChain) return
        toast('Switching network to match the basket...', 'info')
        await switchChainAsync({ chainId: numericChainId })
        walletOnTargetChain = true
      }

      try {
        setPendingNetworkId(String(networkId))

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
            toast('Sending basket unverified', 'info')
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

        // The pre-check only skips a relay round trip that the local cooldown mirror already
        // knows is doomed; the server stays the authority once a request goes out.
        let relayUsable = isGaslessEnabled(networkId) && gaslessCooldown('batchLike', networkId, address) === 0
        let relayedCount = 0

        for (let index = 0; index < batches.length; index++) {
          const batch = batches[index]

          if (batches.length > 1) toast(`Signing batch ${index + 1} of ${batches.length}`, 'info')

          let sent = false

          if (relayUsable) {
            try {
              await relayHupAction({
                chain: chainDefinition,
                publicClient: targetPublicClient ?? publicClient,
                owner: address,
                functionName: 'batchLike',
                args: [address, batch],
                signTypedDataAsync,
                useSessionKey: session.active,
              })

              sent = true
              relayedCount++
            } catch (err) {
              // Unlike posting, a like cooldown falls back to the paid path instead of
              // stopping: the free-like window can be a long wait, hearts that stop working
              // read as broken, and the wallet prompt itself is the user's consent to pay.
              relayUsable = false
              if (err.code === 'RELAY_COOLDOWN') {
                toast('Free-like allowance is used up for now — sending with your wallet instead.', 'info')
              } else {
                console.warn('Gasless like unavailable:', err.message)
              }
            }
          }

          if (!sent) {
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
              await ensureWalletChain()
              await writeContractAsync({
                abi,
                chainId: numericChainId,
                address: targetChain.hup,
                functionName: 'batchLike',
                args: [address, batch],
              })
            }
          }

          // Flag every signed post as liked so feed hearts turn red immediately instead of
          // waiting for the indexer plus a manual refresh. Clearing per batch keeps the
          // unsigned remainder queued if a later one fails.
          markLikeOverride(address, networkId, batch, true)
          batch.forEach((id) => removeFromBatch(address, networkId, id))
        }

        const likedLabel = queue.length === 1 ? 'Post Liked' : 'Posts Liked'
        toast(
          relayedCount === batches.length
            ? `${likedLabel} — gas covered by Hup!`
            : session.active
              ? `${likedLabel} via active session key!`
              : likedLabel,
          'success',
        )
      } catch (err) {
        console.error('Batch like transaction failed:', err)
        toast(shortTxError(err, 'Batch like failed'), 'error')
      } finally {
        setPendingNetworkId(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sendSolanaBatch closes over the same store setters and the Solana signer getter, which are stable
    [address, solanaAddress, config, groups, isConnected, markLikeOverride, publicClient, removeFromBatch, signTypedDataAsync, switchChainAsync, walletChainId, writeContractAsync],
  )

  const clear = useCallback((networkId) => clearBatch(ownerFor(networkId), networkId), [address, solanaAddress, clearBatch])

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

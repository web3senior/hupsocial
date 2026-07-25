'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useChainId, useConfig, useSwitchChain, useWriteContract, usePublicClient, useConnection } from 'wagmi'
import { ArrowRightIcon, HeartIcon, SpinnerIcon, StackIcon, TrashIcon } from '@phosphor-icons/react'
import { useSidebarStore, getWalletBatchMap } from '@/stores/useSidebarStore'
import PageTitle from '@/components/PageTitle'
import { getNetworkDisplayName } from '@/lib/chains'
import { CONTRACTS } from '@/config/wagmi'
import abi from '@/abi/post.json'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { toast } from '@/components/NextToast'
import { shortTxError } from '@/lib/utils'
import styles from './page.module.scss'

// Mirrored from Hup.sol. batchLike is all-or-nothing: it reverts the whole
// array on an oversized batch or on a single unlikeable id, so the basket is
// validated and sliced here instead of failing at wallet gas estimation.
const MAX_BATCH_LIKE_COUNT = 50
const MAX_BATCH_READ_COUNT = 100
const CONTENT_TYPE_REPOST = 2

const chunk = (items, size) => {
  const groups = []
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size))
  return groups
}

// Reason labels double as the toast copy, so keep them short and plural-safe
const describeDropped = (dropped) => {
  const counts = dropped.reduce((acc, entry) => ({ ...acc, [entry.reason]: (acc[entry.reason] ?? 0) + 1 }), {})
  return Object.entries(counts)
    .map(([reason, count]) => `${count} ${reason}`)
    .join(', ')
}

/**
 * Splits a queued basket into the ids batchLike will accept and the ids it can
 * never accept. Ids keep their original type so removeFromBatch still matches.
 * @param {Object} params
 * @param {Object} params.client Public client bound to the queued network.
 * @param {string} params.contractAddress Hup contract on that network.
 * @param {Array} params.ids Queued post ids for the network.
 * @param {string} params.viewer Wallet the likes are attributed to.
 * @returns {Promise<{likeable: Array, dropped: Array<{id: *, reason: string}>}>}
 */
const preflightQueue = async ({ client, contractAddress, ids, viewer }) => {
  const contentCount = await client.readContract({
    abi,
    address: contractAddress,
    functionName: 'contentCount',
  })

  const likeable = []
  const dropped = []
  const inRange = []

  for (const id of ids) {
    let numeric

    try {
      numeric = BigInt(id)
    } catch {
      dropped.push({ id, reason: 'unreadable' })
      continue
    }

    if (numeric <= 0n || numeric > contentCount) dropped.push({ id, reason: 'missing' })
    else inRange.push({ id, numeric })
  }

  for (const group of chunk(inRange, MAX_BATCH_READ_COUNT)) {
    const views = await client.readContract({
      abi,
      address: contractAddress,
      functionName: 'getContents',
      args: [group.map((entry) => entry.numeric), viewer],
    })

    group.forEach((entry, index) => {
      const view = views[index]

      if (!view) dropped.push({ id: entry.id, reason: 'missing' })
      else if (view.isDeleted) dropped.push({ id: entry.id, reason: 'deleted' })
      else if (Number(view.cType) === CONTENT_TYPE_REPOST) dropped.push({ id: entry.id, reason: 'reposts' })
      else if (view.hasLiked) dropped.push({ id: entry.id, reason: 'already liked' })
      else likeable.push(entry.id)
    })
  }

  return { likeable, dropped }
}

export default function Page() {
  const router = useRouter()
  const config = useConfig()

  // Extract account authentication, chain utility, and transaction hooks
  const { isConnected, address } = useConnection()
  const { switchChainAsync } = useSwitchChain()
  const { mutateAsync: writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  // Reactive, unlike a render-time chain snapshot: the value below is read
  // again after switchChainAsync resolves
  const walletChainId = useChainId()
  const likedPostIdsMap = useSidebarStore((state) => state.likedPostIds ?? {})
  const removeFromBatch = useSidebarStore((state) => state.removeFromBatch)
  const clearBatch = useSidebarStore((state) => state.clearBatch)
  const markLikeOverride = useSidebarStore((state) => state.markLikeOverride)

  // Track transaction execution state overlays locally
  const [isProcessing, setIsProcessing] = useState(false)

  // Only the connected wallet's own basket is visible on this page
  const walletQueueMap = useMemo(() => getWalletBatchMap(likedPostIdsMap, address), [likedPostIdsMap, address])

  const networkIds = useMemo(() => {
    return Object.keys(walletQueueMap).filter((netId) => walletQueueMap[netId]?.length > 0)
  }, [walletQueueMap])

  const [activeNetworkId, setActiveNetworkId] = useState('')

  // The queued network is not necessarily the connected one, so the preflight
  // reads through a client pinned to the basket's own chain
  const targetPublicClient = usePublicClient({ chainId: Number(activeNetworkId) || undefined })

  useMemo(() => {
    if (networkIds.length > 0 && !networkIds.includes(activeNetworkId)) {
      setActiveNetworkId(networkIds[0])
    }
  }, [networkIds, activeNetworkId])

  const currentNetworkPosts = useMemo(() => {
    if (!activeNetworkId) return []
    return walletQueueMap[activeNetworkId] ?? []
  }, [walletQueueMap, activeNetworkId])

  // Process the staged list for the active network using multi-call pipelines
  const handleExecuteBatchLike = async () => {
    if (!isConnected || !address) {
      toast('Please connect your wallet first', 'error')
      return
    }

    if (currentNetworkPosts.length === 0) {
      toast('No queued interactions found for this network', 'error')
      return
    }

    const numericChainId = Number(activeNetworkId)
    const targetChain = CONTRACTS[`chain${activeNetworkId}`]
    if (!targetChain?.hup) {
      toast('Contract configuration missing for network', 'error')
      return
    }

    const chainDefinition = config.chains.find((item) => item.id === numericChainId)
    if (!chainDefinition) {
      toast('Queued network is not configured', 'error')
      return
    }

    try {
      setIsProcessing(true)

      // Verify that the connected user wallet matches the active pipeline target chain
      if (walletChainId !== numericChainId) {
        toast(`Switching network to match the basket...`, 'info')
        await switchChainAsync({ chainId: numericChainId })
      }

      let queue = currentNetworkPosts
      let dropped = []

      if (targetPublicClient) {
        try {
          const result = await preflightQueue({
            client: targetPublicClient,
            contractAddress: targetChain.hup,
            ids: currentNetworkPosts,
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
        dropped.forEach((entry) => removeFromBatch(address, activeNetworkId, entry.id))
        toast(`Skipped ${describeDropped(dropped)}`, 'info')
      }

      if (queue.length === 0) {
        toast('Nothing left to like here', 'info')
        return
      }

      // Check current window context status for a valid background delegation session
      const session = await isSessionActive({
        userAddress: address,
        publicClient: targetPublicClient ?? publicClient,
      })

      const groups = chunk(queue, MAX_BATCH_LIKE_COUNT)

      for (let index = 0; index < groups.length; index++) {
        const group = groups[index]

        if (groups.length > 1) toast(`Signing batch ${index + 1} of ${groups.length}`, 'info')

        if (session.active) {
          // Burner key authorization route needs no wallet confirmation
          await writeWithBurnerSession({
            chain: chainDefinition,
            contractAddress: targetChain.hup,
            abi: abi,
            functionName: 'batchLike',
            args: [address, group],
          })
        } else {
          // Base ledger wallet fallback pathway requiring local user confirmation
          await writeContractAsync({
            abi,
            chainId: numericChainId,
            address: targetChain.hup,
            functionName: 'batchLike',
            args: [address, group],
          })
        }

        // Flag every signed post as liked so feed hearts turn red immediately
        // instead of waiting for the indexer plus a manual refresh. Clearing per
        // chunk keeps the unsigned remainder queued if a later one fails.
        markLikeOverride(address, activeNetworkId, group, true)
        group.forEach((id) => removeFromBatch(address, activeNetworkId, id))
      }

      toast(session.active ? 'Liked via active session key!' : 'Batch like sent!', 'success')
    } catch (err) {
      console.error('Batch evaluation transaction failed:', err)
      toast(shortTxError(err, 'Batch like failed'), 'error')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <>
      <PageTitle name="Batch Like Basket" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="small">
          {networkIds.length === 0 ? (
            <div className={styles.emptyState}>
              <HeartIcon size={48} className={styles.emptyIcon} />
              <h3>Your basket is empty</h3>
              <p>Explore your feed and toggle heart items to queue batch interactions across chains seamlessly.</p>
              <button type="button" className="btn btn--primary" onClick={() => router.push('/')}>
                Go to Feed
              </button>
            </div>
          ) : (
            <div className={styles.batchLayout}>
              <div className={styles.networkTabs}>
                <span className={styles.tabsLabel}>
                  <StackIcon size={14} />
                  <span>Active Networks</span>
                </span>
                <div className={styles.tabsList}>
                  {networkIds.map((netId) => {
                    const count = walletQueueMap[netId]?.length ?? 0
                    return (
                      <button
                        key={netId}
                        type="button"
                        disabled={isProcessing}
                        className={`${styles.tabItem} ${activeNetworkId === netId ? styles.tabItemActive : ''}`}
                        onClick={() => setActiveNetworkId(netId)}
                      >
                        <span className={styles.networkName}>{getNetworkDisplayName(config, netId)}</span>
                        <span className={styles.networkCountBadge}>{count}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className={styles.queueContent}>
                {activeNetworkId && (
                  <div className={styles.panelHeader}>
                    <div className={styles.panelTitleBlock}>
                      <h3>{getNetworkDisplayName(config, activeNetworkId)} Queue Summary</h3>
                      <p>Staging {currentNetworkPosts.length} updates for batch interaction payload arrays.</p>
                    </div>
                    <button
                      type="button"
                      disabled={isProcessing}
                      className={styles.clearAllButton}
                      onClick={() => clearBatch(address, activeNetworkId)}
                    >
                      <TrashIcon size={15} />
                      <span>Clear All</span>
                    </button>
                  </div>
                )}

                <ul className={styles.postsSummaryList}>
                  {currentNetworkPosts.map((postId) => (
                    <li key={postId} className={styles.postSummaryItem}>
                      <div className={styles.postMetaItem}>
                        <span className={styles.postTypeTag}>Post Reference</span>
                        <span className={styles.postIdValue}>#{postId}</span>
                      </div>
                      <div className={styles.itemActionControls}>
                        <Link href={`/networks/${activeNetworkId}/${postId}`} className={styles.viewLinkItem}>
                          <span>View Source</span>
                          <ArrowRightIcon size={14} />
                        </Link>
                        <button
                          type="button"
                          disabled={isProcessing}
                          className={styles.deleteRowButton}
                          onClick={() => removeFromBatch(address, activeNetworkId, postId)}
                        >
                          <TrashIcon size={16} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>

                {currentNetworkPosts.length > 0 && (
                  <div className={styles.checkoutActionsContainer}>
                    <button type="button" className="btn btn--primary btn--full" disabled={isProcessing} onClick={handleExecuteBatchLike}>
                      {isProcessing ? (
                        <>
                          <SpinnerIcon size={16} className="animate spin" />
                          <span>Processing...</span>
                        </>
                      ) : (
                        <>
                          <span>Sign Batch Like</span>
                          <ArrowRightIcon size={16} />
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useConfig, useSwitchChain, useWriteContract, usePublicClient, useConnection } from 'wagmi'
import { ArrowRightIcon, HeartIcon, SpinnerIcon, StackIcon, TrashIcon } from '@phosphor-icons/react'
import { useSidebarStore, getWalletBatchMap } from '@/stores/useSidebarStore'
import PageTitle from '@/components/PageTitle'
import { getNetworkDisplayName } from '@/lib/chains'
import { CONTRACTS } from '@/config/wagmi'
import abi from '@/abi/post.json'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { toast } from '@/components/NextToast'
import styles from './page.module.scss'
import { getActiveChain } from '@/lib/communication'

export default function Page() {
  const router = useRouter()
  const config = useConfig()

  // Extract account authentication, chain utility, and transaction hooks
  const { isConnected, address } = useConnection()
  const { switchChainAsync } = useSwitchChain()
  const { mutateAsync: writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  const activeChain = getActiveChain()[0]
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

    try {
      setIsProcessing(true)

      console.log(activeChain)

      // Verify that the connected user wallet matches the active pipeline target chain
      if (!activeChain || activeChain.id !== numericChainId) {
        toast(`Switching network connection to match pipeline parameters...`, 'info')
        await switchChainAsync({ chainId: numericChainId })
      }

      // Check current window context status for a valid background delegation session
      const session = await isSessionActive({
        userAddress: address,
        publicClient,
      })

      if (session.active) {
        // Burner key authorization route clears target stack instantly
        await writeWithBurnerSession({
          chain: activeChain,
          contractAddress: targetChain.hup,
          abi: abi,
          functionName: 'batchLike',
          args: [address, currentNetworkPosts],
        })

        toast('Successfully batched interaction items via session keys!', 'success')
        // Flag every signed post as liked so feed hearts turn red immediately
        // instead of waiting for the indexer plus a manual refresh
        markLikeOverride(address, activeNetworkId, currentNetworkPosts, true)
        clearBatch(address, activeNetworkId)
        setIsProcessing(false)
        return
      }

      console.log(address, currentNetworkPosts, targetChain.hup)

      // Base ledger wallet fallback pathway requiring local user confirmation
      await writeContractAsync({
        abi,

        address: targetChain.hup,
        functionName: 'batchLike',
        args: [address, currentNetworkPosts],
      })

      toast('Transaction sent! Clearing localized buffer parameters...', 'success')
      markLikeOverride(address, activeNetworkId, currentNetworkPosts, true)
      clearBatch(address, activeNetworkId)
    } catch (err) {
      console.error('Batch evaluation transaction failed:', err)
      toast(err.shortMessage || 'Transaction failed', 'error')
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

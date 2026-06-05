'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useConfig, useAccount, useSwitchChain, useWriteContract, usePublicClient } from 'wagmi'
import { Trash2, Layers, ArrowRight, Heart, Loader2 } from 'lucide-react'

import { useSidebarStore } from '@/stores/useSidebarStore'
import PageTitle from '@/components/PageTitle'
import { getNetworkDisplayName } from '@/lib/chains'
import { CONTRACTS } from '@/config/wagmi'
import { postAbi } from '@/abi/post'
import { isSessionActive, writeWithBurnerSession } from '@/lib/BurnerSession'
import { toast } from '@/components/NextToast'
import styles from './page.module.scss'

export default function Page() {
  const router = useRouter()
  const config = useConfig()
  
  // Extract account authentication, chain utility, and transaction hooks
  const { isConnected, address, chain: activeChain } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()

  const likedPostIdsMap = useSidebarStore((state) => state.likedPostIds ?? {})
  const removeFromBatch = useSidebarStore((state) => state.removeFromBatch)
  const clearBatch = useSidebarStore((state) => state.clearBatch)

  // Track transaction execution state overlays locally
  const [isProcessing, setIsProcessing] = useState(false)

  const networkIds = useMemo(() => {
    if (Array.isArray(likedPostIdsMap)) return []
    return Object.keys(likedPostIdsMap).filter(
      (netId) => likedPostIdsMap[netId]?.length > 0
    )
  }, [likedPostIdsMap])

  const [activeNetworkId, setActiveNetworkId] = useState(() => {
    if (Array.isArray(likedPostIdsMap)) return ''
    const keys = Object.keys(likedPostIdsMap).filter(
      (netId) => likedPostIdsMap[netId]?.length > 0
    )
    return keys[0] || ''
  })

  useMemo(() => {
    if (networkIds.length > 0 && !networkIds.includes(activeNetworkId)) {
      setActiveNetworkId(networkIds[0])
    }
  }, [networkIds, activeNetworkId])

  const currentNetworkPosts = useMemo(() => {
    if (Array.isArray(likedPostIdsMap) || !activeNetworkId) return []
    return likedPostIdsMap[activeNetworkId] ?? []
  }, [likedPostIdsMap, activeNetworkId])

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
          chain: activeChain || { id: numericChainId },
          contractAddress: targetChain.hup,
          abi: postAbi,
          functionName: 'batchLike',
          args: [address, currentNetworkPosts],
        })

        toast('Successfully batched interaction items via session keys!', 'success')
        clearBatch(activeNetworkId)
        setIsProcessing(false)
        return
      }

      // Base ledger wallet fallback pathway requiring local user confirmation
      await writeContractAsync({
        abi: postAbi,
        address: targetChain.hup,
        functionName: 'batchLike',
        args: [address, currentNetworkPosts],
      })

      toast('Transaction sent! Clearing localized buffer parameters...', 'success')
      clearBatch(activeNetworkId)
    } catch (err) {
      console.error('Batch evaluation transaction failed:', err)
      toast(err.message || 'Transaction rejected or encountered a processing failure.', 'error')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <>
      <PageTitle name="Batch Like Basket" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          {networkIds.length === 0 ? (
            <div className={styles.emptyState}>
              <Heart size={48} className={styles.emptyIcon} strokeWidth={1.2} />
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
                  <Layers size={14} />
                  <span>Active Networks</span>
                </span>
                <div className={styles.tabsList}>
                  {networkIds.map((netId) => {
                    const count = likedPostIdsMap[netId]?.length ?? 0
                    return (
                      <button
                        key={netId}
                        type="button"
                        disabled={isProcessing}
                        className={`${styles.tabItem} ${activeNetworkId === netId ? styles.tabItemActive : ''}`}
                        onClick={() => setActiveNetworkId(netId)}
                      >
                        <span className={styles.networkName}>
                          {getNetworkDisplayName(config, netId)}
                        </span>
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
                      onClick={() => clearBatch(activeNetworkId)}
                    >
                      <Trash2 size={15} />
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
                          <ArrowRight size={14} />
                        </Link>
                        <button
                          type="button"
                          disabled={isProcessing}
                          className={styles.deleteRowButton}
                          onClick={() => removeFromBatch(activeNetworkId, postId)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>

                {currentNetworkPosts.length > 0 && (
                  <div className={styles.checkoutActionsContainer}>
                    <button
                      type="button"
                      className="btn btn--primary btn--full"
                      disabled={isProcessing}
                      onClick={handleExecuteBatchLike}
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 size={16} className="animate spin" />
                          <span>Processing Array Payload...</span>
                        </>
                      ) : (
                        <>
                          <span>Sign Multi-Call Like Payload</span>
                          <ArrowRight size={16} />
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
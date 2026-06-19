'use client'

import { useEffect, useMemo } from 'react'
import clsx from 'clsx'
import { Heart } from 'lucide-react'
import useSWR from 'swr'
import { useWaitForTransactionReceipt, useConnection, useWriteContract, usePublicClient } from 'wagmi'
import { getActiveChain } from '@/lib/communication'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { CONTRACTS } from '@/config/wagmi'
import abi from '@/abi/post.json'
import { useSidebarStore } from '@/stores/useSidebarStore'
import { useClientMounted } from '@/hooks/useClientMount'
import { toast } from '@/components/NextToast'
import { AnimatedHeart } from '@/components/Icons'
import { getPostById } from '@/lib/api'
import styles from './Like.module.scss'

const localStorageBatchLikeKey = `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}batch_like_enabled`

/**
 * Like Interaction Component
 * @param {Object} props
 * @param {Object} props.post Core content model with network metadata and like metrics.
 * @param {Function} [props.onUpdate] Optional parent update callback to sync list states.
 */

export const Like = ({ post, onUpdate }) => {
  // ■■■ Store Subscriptions ■■■
  const addToBatch = useSidebarStore((state) => state.addToBatch)
  const removeFromBatch = useSidebarStore((state) => state.removeFromBatch)
  const likedPostIdsMap = useSidebarStore((state) => state.likedPostIds ?? {})

  const isMounted = useClientMounted()
  const activeChain = getActiveChain()
  const { address, isConnected } = useConnection()
  const publicClient = usePublicClient()

  // ■■■ SWR Data Fetching Configuration ■■■
  const cacheKey = post?.id ? `posts/${post.network_id}/${post.id}/${address || 'anonymous'}/likes` : null

  const fetcher = async () => {
    try {
      const res = await getPostById(post.network_id, post.id, address)
      const freshPost = Array.isArray(res?.data) ? res.data[0] : res?.data

      if (!freshPost) return null

      // Reading the correct "has_liked" property returned by the Cidex indexer
      const userHasLiked =
        freshPost.has_liked === 1 || freshPost.has_liked === true || freshPost.is_liked === 1 || freshPost.is_liked === true

      return {
        isLiked: userHasLiked,
        likeCount: Number(freshPost.total_likes) || 0,
        isProcessing: false,
      }
    } catch (error) {
      console.error('Failed to sync post interaction state via API:', error)
      return {
        isLiked: post.is_liked === 1 || post.is_liked === true,
        likeCount: Number(post.total_likes) || 0,
        isProcessing: false,
      }
    }
  }

  const { data: interactionState, mutate } = useSWR(cacheKey, fetcher, {
    fallbackData: {
      isLiked: post.is_liked === 1 || post.is_liked === true,
      likeCount: Number(post.total_likes) || 0,
      isProcessing: false,
    },
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  })

  // State & Memo Hooks
  const currentNetworkQueue = useMemo(() => {
    if (Array.isArray(likedPostIdsMap)) return likedPostIdsMap
    return likedPostIdsMap[post.network_id] ?? []
  }, [likedPostIdsMap, post.network_id])

  const isQueued = currentNetworkQueue.includes(post.id)

  // Web3 Hooks
  const { data: hash, isPending: isWalletPending, writeContractAsync } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  useEffect(() => {
    if (isConfirmed) {
      mutate(
        (prev) => ({
          ...prev,
          isProcessing: false,
          isLiked: true,
        }),
        { revalidate: true },
      )

      if (typeof onUpdate === 'function') {
        onUpdate(post.id, { is_liked: 1, total_likes: interactionState.likeCount })
      }
      toast('Interaction saved on-chain!', 'success')
    }
  }, [isConfirmed])
  
  /**
   * Like post
   * @param {integer} id
   * @returns
   */
  const likePost = async (id) => {
    if (!isConnected || !address) {
      toast('Please connect your wallet first', 'error')
      return
    }

    const targetChain = CONTRACTS[`chain${post.network_id}`]
    if (!targetChain?.hup) {
      toast('Contract configuration missing for network', 'error')
      return
    }

    const previousData = interactionState

    try {
      mutate(
        {
          isLiked: true,
          likeCount: previousData.likeCount + 1,
          isProcessing: true,
        },
        { revalidate: false },
      )

      const session = await isSessionActive({
        userAddress: address,
        publicClient,
      })

      if (session.active) {
        await writeWithBurnerSession({
          chain: activeChain[0],
          contractAddress: targetChain.hup,
          abi,
          functionName: 'batchLike',
          args: [address, [id]],
        })

        mutate((prev) => ({ ...prev, isProcessing: false }), { revalidate: true })

        if (typeof onUpdate === 'function') {
          onUpdate(id, { is_liked: 1, total_likes: previousData.likeCount + 1 })
        }

        toast('Liked via active session key!', 'success')
        return
      }

      await writeContractAsync({
        abi,
        address: targetChain.hup,
        functionName: 'batchLike',
        args: [address, [id]],
      })

      toast('Confirming block execution...', 'success')
    } catch (err) {
      console.error('Like failed:', err)
      toast(err.message || 'Transaction rejected or encountered an error.', 'error')
      mutate(previousData, { revalidate: false })
    }
  }

  const unlikePost = async (id) => {
    if (!isConnected) {
      toast('Please connect your wallet first', 'error')
      return
    }

    const targetChain = CONTRACTS[`chain${post.network_id}`]
    if (!targetChain?.hup) {
      toast('Contract configuration missing for network', 'error')
      return
    }

    const previousData = interactionState

    try {
      mutate(
        {
          isLiked: false,
          likeCount: Math.max(0, previousData.likeCount - 1),
          isProcessing: true,
        },
        { revalidate: false },
      )

      await writeContractAsync({
        abi,
        address: targetChain.hup,
        functionName: 'batchUnLike',
        args: [id],
      })

      mutate((prev) => ({ ...prev, isProcessing: false }), { revalidate: true })

      toast('Removing like on-chain...', 'success')
    } catch (err) {
      console.error('Unlike failed:', err)
      toast(err.message || 'Failed to remove transaction.', 'error')
      mutate(previousData, { revalidate: false })
    }
  }

  const handleLikeInteraction = (e) => {
    e.stopPropagation()

    if (!isConnected) {
      toast('Please connect wallet', 'error')
      return
    }

    if (interactionState.isLiked) {
      unlikePost(post.id)
    } else if (isQueued) {
      removeFromBatch(post.network_id, post.id)
    } else {
      const batchLikePref = localStorage.getItem(localStorageBatchLikeKey)
      const isBatchLikeEnabled = batchLikePref === 'true'

      if (isBatchLikeEnabled) {
        addToBatch(post.network_id, post.id)
      } else {
        likePost(post.id)
      }
    }
  }

  // ■■■ UI Style Layout Variables ■■■
  const isLoading = interactionState.isProcessing || isWalletPending || isConfirming
  const heartColor = interactionState.isLiked ? 'var(--liked-color, red)' : isQueued ? 'var(--batch-like-color, #facc15)' : 'currentColor'
  const heartFill = interactionState.isLiked ? 'var(--liked-color, red)' : isQueued ? 'var(--batch-like-color, #facc15)' : 'none'

  if (!isMounted) return null

  return (
    <div className={clsx('flex', 'align-items-center', 'gap-050')}>
      <button
        disabled={isLoading}
        className={clsx('like-button', isLoading && 'processing', isQueued && 'queued')}
        onClick={handleLikeInteraction}
        aria-label={interactionState.isLiked ? 'Unlike post' : isQueued ? 'Remove from batch queue' : 'Add to batch'}
      >
        {isLoading ? (
          <div className={clsx(styles.animatedHeader)}>
            <AnimatedHeart />
          </div>
        ) : (
          <Heart strokeWidth={1.5} width={18} height={18} color={heartColor} fill={heartFill} />
        )}

        {interactionState.likeCount > 0 && !isLoading && (
          <div className={styles.counterWrapper}>
            <span key={interactionState.likeCount} className={styles.counterNumber}>
              {interactionState.likeCount}
            </span>
          </div>
        )}
      </button>
    </div>
  )
}

export default Like

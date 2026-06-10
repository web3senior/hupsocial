'use client'

import { useState, useEffect, useMemo } from 'react'
import clsx from 'clsx'
import { Heart } from 'lucide-react'
import { useWaitForTransactionReceipt, useConnection, useWriteContract, usePublicClient } from 'wagmi'
import { getActiveChain } from '@/lib/communication'
import { isSessionActive, writeWithBurnerSession } from '@/lib/BurnerSession'
import { CONTRACTS } from '@/config/wagmi'
import abi from '@/abi/post.json'
import { useSidebarStore } from '@/stores/useSidebarStore'
import { useClientMounted } from '@/hooks/useClientMount'
import { toast } from '@/components/NextToast'
import { AnimatedHeart } from '@/components/Icons'
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

  // ■■■ State & Memo Hooks ■■■
  const currentNetworkQueue = useMemo(() => {
    if (Array.isArray(likedPostIdsMap)) return likedPostIdsMap
    return likedPostIdsMap[post.network_id] ?? []
  }, [likedPostIdsMap, post.network_id])

  const isQueued = currentNetworkQueue.includes(post.id)

  const [isLiked, setIsLiked] = useState(post.is_liked === 1 || post.is_liked === true)
  const [likeCount, setLikeCount] = useState(Number(post.total_likes) || 0)
  const [isProcessing, setIsProcessing] = useState(false)

  const isMounted = useClientMounted()
  const activeChain = getActiveChain()
  const { address, isConnected } = useConnection()

  // ■■■ Web3 Hooks ■■■
  const { data: hash, isPending: isWalletPending, writeContractAsync } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  const publicClient = usePublicClient()

  // ■■■ Effects ■■■
  useEffect(() => {
    if (isConfirmed) {
      setIsProcessing(false)
      setIsLiked(true)
      setLikeCount((prev) => prev + 1)

      if (typeof onUpdate === 'function') {
        onUpdate(post.id, { is_liked: 1, total_likes: likeCount + 1 })
      }
      toast('Interaction saved on-chain!', 'success')
    }
  }, [isConfirmed])

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

    try {
      setIsProcessing(true)

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

        setIsLiked(true)
        setLikeCount((prev) => prev + 1)
        if (typeof onUpdate === 'function') {
          onUpdate(id, { is_liked: 1, total_likes: likeCount + 1 })
        }

        toast('Liked via active session key!', 'success')
        setIsProcessing(false)
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
      setIsProcessing(false)
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

    try {
      setIsProcessing(true)

      await writeContractAsync({
        abi,
        address: targetChain.hup,
        functionName: 'batchUnLike',
        args: [id],
      })

      setIsLiked(false)
      setLikeCount((prev) => Math.max(0, prev - 1))
      setIsProcessing(false)

      toast('Removing like on-chain...', 'success')
    } catch (err) {
      console.error('Unlike failed:', err)
      toast(err.message || 'Failed to remove transaction.', 'error')
      setIsProcessing(false)
    }
  }

  const handleLikeInteraction = (e) => {
    e.stopPropagation()

    if (!isConnected) {
      toast('Please connect wallet', 'error')
      return
    }

    if (isLiked) {
      unlikePost(post.id)
    } else if (isQueued) {
      removeFromBatch(post.network_id, post.id)
    } else {
      // Check if Batch Like toggle preference is active in localStorage
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
  const isLoading = isProcessing || isWalletPending || isConfirming
  const heartColor = isLiked ? 'var(--liked-color, red)' : isQueued ? 'var(--batch-like-color, #facc15)' : 'currentColor'
  const heartFill = isLiked ? 'var(--liked-color, red)' : isQueued ? 'var(--batch-like-color, #facc15)' : 'none'

  if (!isMounted) return null

  return (
    <div className={clsx('flex', 'align-items-center', 'gap-050')}>
      <button
        disabled={isLoading}
        className={clsx('like-button', isLoading && 'processing', isQueued && 'queued')}
        onClick={handleLikeInteraction}
        aria-label={isLiked ? 'Unlike post' : isQueued ? 'Remove from batch queue' : 'Add to batch'}
      >
        {isLoading ? (
          <div className={clsx(styles.animatedHeader)}>
            <AnimatedHeart />
          </div>
        ) : (
          <Heart strokeWidth={1.5} width={18} height={18} color={heartColor} fill={heartFill} />
        )}

        {likeCount > 0 && !isLoading && <span>{likeCount}</span>}
      </button>
    </div>
  )
}

export default Like
'use client'

import { useEffect, useMemo, useRef } from 'react'
import clsx from 'clsx'
import { HeartIcon } from '@phosphor-icons/react'
import useSWR from 'swr'
import { useWaitForTransactionReceipt, useConnection, useSignTypedData, useWriteContract, usePublicClient } from 'wagmi'
import { getPublicClient } from 'wagmi/actions'
import { getActiveChain } from '@/lib/communication'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { gaslessCooldown, isGaslessEnabled, relayHupAction } from '@/lib/relayGasless'
import { CONTRACTS, config } from '@/config/wagmi'
import abi from '@/abi/post.json'
import { useSidebarStore, getWalletBatchMap, getLikeOverride } from '@/stores/useSidebarStore'
import { useClientMounted } from '@/hooks/useClientMount'
import { toast } from '@/components/NextToast'
import { getPostById } from '@/lib/api'
import { shortTxError } from '@/lib/utils'
import Counter from './Counter'
import Tooltip from './Tooltip'

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
  const likeOverridesMap = useSidebarStore((state) => state.likeOverrides ?? {})
  const markLikeOverride = useSidebarStore((state) => state.markLikeOverride)

  const isMounted = useClientMounted()
  const activeChain = getActiveChain()
  const { address, isConnected } = useConnection()
  const publicClient = usePublicClient()
  const { signTypedDataAsync } = useSignTypedData()

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
    // The feed row already carries is_liked/total_likes; without this flag
    // every mounted card refetches its own post row on page load. Like
    // actions revalidate explicitly via mutate().
    revalidateOnMount: false,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  })

  // State & Memo Hooks
  const currentNetworkQueue = useMemo(() => {
    return getWalletBatchMap(likedPostIdsMap, address)[post.network_id] ?? []
  }, [likedPostIdsMap, address, post.network_id])

  const isQueued = currentNetworkQueue.includes(post.id)

  // Web3 Hooks
  const { data: hash, isPending: isWalletPending, mutateAsync: writeContractAsync } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  // The same receipt hook confirms both like and unlike txs; the ref remembers
  // which intent the pending hash belongs to
  const pendingActionRef = useRef(null)

  useEffect(() => {
    if (isConfirmed) {
      const confirmedLike = pendingActionRef.current !== 'unlike'
      pendingActionRef.current = null

      // Pin the optimistic state past the cidex indexing lag so the immediate
      // revalidation below cannot flip the heart back
      markLikeOverride(address, post.network_id, post.id, confirmedLike)

      mutate(
        (prev) => ({
          ...prev,
          isProcessing: false,
          isLiked: confirmedLike,
        }),
        { revalidate: true },
      )

      if (typeof onUpdate === 'function') {
        onUpdate(post.id, { is_liked: confirmedLike ? 1 : 0, total_likes: interactionState.likeCount })
      }
      toast('Interaction saved onchain!', 'success')
    }
  }, [isConfirmed])
  
  /**
   * Relays a heart action (batchLike([id]) or unlike(id)) through the forwarder so the tap
   * costs the user nothing. Returns false whenever the relay is unavailable — cooldown
   * included: the free window can be a long wait, so the tap falls back to the usual
   * session/wallet path instead of blocking, and the wallet prompt there is the user's
   * consent to pay. Unlike has a much smaller window than like on purpose — that asymmetry
   * is what caps heart-toggle farming (see config/gasless.js).
   * @param {string} functionName 'batchLike' or 'unlike'.
   * @param {Array} args Owner-first args for that function.
   * @returns {Promise<boolean>} Whether the action went out sponsored.
   */
  const tryGaslessHeart = async (functionName, args) => {
    const chainId = Number(post.network_id)
    if (!isGaslessEnabled(chainId)) return false
    if (gaslessCooldown(functionName, chainId, address) > 0) return false

    const chainDefinition = config.chains.find((item) => item.id === chainId)
    if (!chainDefinition) return false

    // Pinned to the post's own chain: the relay reads nonce and forwarder trust there,
    // regardless of which network the wallet is connected to
    const targetPublicClient = getPublicClient(config, { chainId }) ?? publicClient

    try {
      const session = await isSessionActive({ userAddress: address, publicClient: targetPublicClient })

      await relayHupAction({
        chain: chainDefinition,
        publicClient: targetPublicClient,
        owner: address,
        functionName,
        args,
        signTypedDataAsync,
        useSessionKey: session.active,
      })

      return true
    } catch (err) {
      if (err.code === 'RELAY_COOLDOWN') {
        toast('Free-like allowance is used up for now — using your wallet instead.', 'info')
      } else {
        console.warn('Gasless like unavailable:', err.message)
      }
      return false
    }
  }

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

      if (await tryGaslessHeart('batchLike', [address, [id]])) {
        markLikeOverride(address, post.network_id, id, true)
        mutate((prev) => ({ ...prev, isProcessing: false }), { revalidate: true })

        if (typeof onUpdate === 'function') {
          onUpdate(id, { is_liked: 1, total_likes: previousData.likeCount + 1 })
        }

        toast('Liked — gas covered by Hup!', 'success')
        return
      }

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

        markLikeOverride(address, post.network_id, id, true)
        mutate((prev) => ({ ...prev, isProcessing: false }), { revalidate: true })

        if (typeof onUpdate === 'function') {
          onUpdate(id, { is_liked: 1, total_likes: previousData.likeCount + 1 })
        }

        toast('Liked via active session key!', 'success')
        return
      }

      pendingActionRef.current = 'like'

      await writeContractAsync({
        abi,
        address: targetChain.hup,
        functionName: 'batchLike',
        args: [address, [id]],
      })

      toast('Confirming block execution...', 'success')
    } catch (err) {
      console.error('Like failed:', err)
      pendingActionRef.current = null
      toast(shortTxError(err, 'Could not like post'), 'error')
      mutate(previousData, { revalidate: false })
    }
  }

  const unlikePost = async (id) => {
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
          isLiked: false,
          likeCount: Math.max(0, previousData.likeCount - 1),
          isProcessing: true,
        },
        { revalidate: false },
      )

      if (await tryGaslessHeart('unlike', [address, id])) {
        markLikeOverride(address, post.network_id, id, false)
        mutate((prev) => ({ ...prev, isProcessing: false }), { revalidate: true })

        if (typeof onUpdate === 'function') {
          onUpdate(id, { is_liked: 0, total_likes: Math.max(0, previousData.likeCount - 1) })
        }

        toast('Like removed — gas covered by Hup!', 'success')
        return
      }

      const session = await isSessionActive({
        userAddress: address,
        publicClient,
      })

      // The contract resolves the burner key back to _owner, so the session key
      // signs unlike() exactly like it signs batchLike()
      if (session.active) {
        await writeWithBurnerSession({
          chain: activeChain[0],
          contractAddress: targetChain.hup,
          abi,
          functionName: 'unlike',
          args: [address, id],
        })

        markLikeOverride(address, post.network_id, id, false)
        mutate((prev) => ({ ...prev, isProcessing: false }), { revalidate: true })

        if (typeof onUpdate === 'function') {
          onUpdate(id, { is_liked: 0, total_likes: Math.max(0, previousData.likeCount - 1) })
        }

        toast('Like removed via active session key!', 'success')
        return
      }

      pendingActionRef.current = 'unlike'

      await writeContractAsync({
        abi,
        address: targetChain.hup,
        functionName: 'unlike',
        args: [address, id],
      })

      markLikeOverride(address, post.network_id, id, false)
      mutate((prev) => ({ ...prev, isProcessing: false }), { revalidate: true })

      toast('Removing like onchain...', 'success')
    } catch (err) {
      console.error('Unlike failed:', err)
      pendingActionRef.current = null
      toast(shortTxError(err, 'Could not remove like'), 'error')
      mutate(previousData, { revalidate: false })
    }
  }

  // ■■■ Derived Display State ■■■
  // A fresh optimistic override outranks the API snapshot: the indexer lags a
  // few blocks behind the tx, so raw revalidations briefly report stale data
  const likeOverride = getLikeOverride(likeOverridesMap, address, post.network_id, post.id)
  const isLiked = likeOverride ? likeOverride.liked : interactionState.isLiked
  const likeCount =
    likeOverride && likeOverride.liked !== interactionState.isLiked
      ? Math.max(0, interactionState.likeCount + (likeOverride.liked ? 1 : -1))
      : interactionState.likeCount

  const handleLikeInteraction = (e) => {
    e.stopPropagation()

    if (!isConnected) {
      toast('Please connect wallet', 'error')
      return
    }

    if (isLiked) {
      unlikePost(post.id)
    } else if (isQueued) {
      removeFromBatch(address, post.network_id, post.id)
    } else {
      const batchLikePref = localStorage.getItem(localStorageBatchLikeKey)
      const isBatchLikeEnabled = batchLikePref !== 'false'

      if (isBatchLikeEnabled) {
        addToBatch(address, post.network_id, post.id)
      } else {
        likePost(post.id)
      }
    }
  }

  // ■■■ UI Style Layout Variables ■■■
  const isLoading = interactionState.isProcessing || isWalletPending || isConfirming
  const heartColor = isLiked ? 'var(--liked-color, #ff007a)' : isQueued ? 'var(--batch-like-color, #facc15)' : 'currentColor'
  const heartWeight = isLiked || isQueued ? 'fill' : 'regular'

  // Names what the next click does — the heart has three states and only one of them
  // reads as "like" from the icon alone
  const likeLabel = isLiked ? 'Unlike' : isQueued ? 'Remove from batch' : 'Like'

  if (!isMounted) return null

  return (
    <div className={clsx('flex', 'align-items-center', 'gap-050')}>
      <Tooltip content={likeLabel} placement="bottom" size="compact" hoverOnly>
        <button
          data-action="like"
          data-liked={isLiked ? 'true' : undefined}
          data-queued={!isLiked && isQueued ? 'true' : undefined}
          disabled={isLoading}
          className={clsx('like-button', isLoading && 'processing', isQueued && 'queued')}
          onClick={handleLikeInteraction}
          aria-label={isLiked ? 'Unlike post' : isQueued ? 'Remove from batch queue' : 'Add to batch'}
        >
          {/* The optimistic heart is the pending feedback — no loader swap, so the
              icon and counter never jump while the tx settles */}
          <HeartIcon width={18} height={18} color={heartColor} weight={heartWeight} />

          {likeCount > 0 && <Counter value={likeCount} />}
        </button>
      </Tooltip>
    </div>
  )
}

export default Like

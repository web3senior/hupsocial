'use client'

import { useEffect, useMemo, useRef } from 'react'
import clsx from 'clsx'
import { HeartIcon } from '@phosphor-icons/react'
import useSWR from 'swr'
import {
  useChainId,
  useConnection,
  usePublicClient,
  useSignTypedData,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { getPublicClient } from 'wagmi/actions'
import { isSessionActive, localStorageBatchLikeKey, writeWithBurnerSession } from '@/lib/burnerSession'
import { gaslessCooldown, isGaslessEnabled, relayHupAction } from '@/lib/relayGasless'
import { CONTRACTS, config } from '@/config/wagmi'
import { isSolanaNetworkId } from '@/config/solana'
import { useSolanaWallet } from '@/hooks/useSolanaWallet'
import { hupInstruction } from '@/lib/solana/hup'
import { sendHupAction } from '@/lib/solana/relay'
import abi from '@/abi/post.json'
import { useSidebarStore, getWalletBatchMap, getLikeOverride } from '@/stores/useSidebarStore'
import { useClientMounted } from '@/hooks/useClientMount'
import { toast } from '@/components/NextToast'
import { getPostById } from '@/lib/api'
import { shortTxError } from '@/lib/utils'
import Counter from './Counter'
import Tooltip from './Tooltip'

/**
 * Like Interaction Component
 *
 * A like is queued into the per-chain basket by default (Settings → Batch Like) and goes
 * onchain when the user taps that chain's floating heart (components/BatchLikeTrigger).
 * With the basket off, and always for unlike, the tap sends immediately — batchLike([id])
 * or unlike(id): sponsored by the relay where the chain allows it, signed silently by an
 * active session key, or confirmed in the wallet.
 *
 * Feeds mix chains, so every read and write here is pinned to the post's own network rather
 * than the wallet's: the relay and the session key sign against that chain locally, and only
 * the wallet path asks the wallet to switch — lazily, right before it signs, so a sponsored
 * heart never opens a network prompt at all.
 *
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
  const { address, isConnected } = useConnection()
  const publicClient = usePublicClient()
  // Reactive, unlike a render-time chain snapshot: read again after switchChainAsync resolves
  const walletChainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const { signTypedDataAsync } = useSignTypedData()

  const chainId = Number(post.network_id)

  // A Solana post is liked by the Solana wallet: everything keyed by the viewer (cache key,
  // basket, optimistic overrides) uses whichever wallet acts on this post's chain
  const isSolanaPost = isSolanaNetworkId(chainId)
  const solanaWallet = useSolanaWallet()
  const actor = isSolanaPost ? solanaWallet.address : address
  const actorConnected = isSolanaPost ? Boolean(solanaWallet.address) : isConnected

  // ■■■ SWR Data Fetching Configuration ■■■
  const cacheKey = post?.id ? `posts/${post.network_id}/${post.id}/${actor || 'anonymous'}/likes` : null

  const fetcher = async () => {
    try {
      const res = await getPostById(post.network_id, post.id, actor)
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
    return getWalletBatchMap(likedPostIdsMap, actor)[post.network_id] ?? []
  }, [likedPostIdsMap, actor, post.network_id])

  const isQueued = currentNetworkQueue.includes(post.id)

  // Web3 Hooks
  const { data: hash, isPending: isWalletPending, mutateAsync: writeContractAsync } = useWriteContract()
  // Watched on the post's chain: the wallet is there too after the switch, but the receipt
  // must not depend on it
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash, chainId })

  // The same receipt hook confirms both like and unlike txs; the ref remembers
  // which intent the pending hash belongs to
  const pendingActionRef = useRef(null)

  useEffect(() => {
    if (isConfirmed) {
      const confirmedLike = pendingActionRef.current !== 'unlike'
      pendingActionRef.current = null

      // Pin the optimistic state past the cidex indexing lag so the immediate
      // revalidation below cannot flip the heart back
      markLikeOverride(actor, post.network_id, post.id, confirmedLike)

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
   * Everything a heart needs about the post's own chain, resolved once per tap.
   * @returns {{targetChain: Object, chainDefinition: Object, targetPublicClient: Object}|null}
   *   Null (after a toast) when the post's network is not configured.
   */
  const resolveTarget = () => {
    const targetChain = CONTRACTS[`chain${post.network_id}`]
    if (!targetChain?.hup) {
      toast('Contract configuration missing for network', 'error')
      return null
    }

    const chainDefinition = config.chains.find((item) => item.id === chainId)
    if (!chainDefinition) {
      toast('Post network is not configured', 'error')
      return null
    }

    return {
      targetChain,
      chainDefinition,
      // Pinned to the post's chain regardless of where the wallet is connected
      targetPublicClient: getPublicClient(config, { chainId }) ?? publicClient,
    }
  }

  // Only the wallet write path needs the wallet on the post's chain
  const ensureWalletChain = async () => {
    if (walletChainId === chainId) return
    toast('Switching network to match the post...', 'info')
    await switchChainAsync({ chainId })
  }

  /**
   * Relays a heart action through the forwarder so the tap costs the user nothing. Returns
   * false whenever the relay is unavailable — cooldown included: the free window can be a
   * long wait, so the tap falls back to the usual session/wallet path instead of blocking,
   * and the wallet prompt there is the user's consent to pay. Unlike has a much smaller
   * window than like on purpose — that asymmetry is what caps heart-toggle farming (see
   * config/gasless.js).
   * @param {string} functionName 'batchLike' or 'unlike'.
   * @param {Array} args Owner-first args for that function.
   * @param {Object} target The post's chain, from resolveTarget().
   * @param {boolean} useSessionKey Whether an active session key should sign the request.
   * @returns {Promise<boolean>} Whether the action went out sponsored.
   */
  const tryGaslessHeart = async (functionName, args, { chainDefinition, targetPublicClient }, useSessionKey) => {
    if (!isGaslessEnabled(chainId)) return false
    if (gaslessCooldown(functionName, chainId, address) > 0) return false

    try {
      await relayHupAction({
        chain: chainDefinition,
        publicClient: targetPublicClient,
        owner: address,
        functionName,
        args,
        signTypedDataAsync,
        useSessionKey,
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
   * The Solana heart: one like/unlike instruction, sponsored when the relay serves the cluster,
   * otherwise signed by the Solana wallet. Confirmed before it settles, so the optimistic state
   * is pinned exactly as the EVM receipt effect pins it.
   * @param {boolean} liked The state the tap moves the post INTO.
   */
  const sendSolanaHeart = async (liked) => {
    const signer = solanaWallet.getSigner()
    if (!signer) {
      toast('Connect your Solana wallet first', 'error')
      return
    }

    const previousData = interactionState
    const nextCount = liked ? previousData.likeCount + 1 : Math.max(0, previousData.likeCount - 1)
    mutate({ isLiked: liked, likeCount: nextCount, isProcessing: true }, { revalidate: false })

    try {
      const build = liked ? hupInstruction.like : hupInstruction.unlike
      const { sponsored } = await sendHupAction({
        networkId: chainId,
        signer,
        instructions: [build({ networkId: chainId, actor: signer.account.address, id: post.id })],
      })

      markLikeOverride(actor, post.network_id, post.id, liked)
      mutate((prev) => ({ ...prev, isProcessing: false }), { revalidate: true })
      if (typeof onUpdate === 'function') onUpdate(post.id, { is_liked: liked ? 1 : 0, total_likes: nextCount })
      toast(`${liked ? 'Liked' : 'Like removed'}${sponsored ? '' : ' onchain!'}`, 'success')
    } catch (err) {
      console.error(`${liked ? 'Like' : 'Unlike'} failed:`, err)
      toast(shortTxError(err, liked ? 'Could not like post' : 'Could not remove like'), 'error')
      mutate(previousData, { revalidate: false })
    }
  }

  /**
   * Sends one heart action immediately and settles the optimistic state.
   * @param {boolean} liked The state the tap moves the post INTO.
   */
  const sendHeart = async (liked) => {
    if (!actorConnected || !actor) {
      toast(isSolanaPost ? 'Connect your Solana wallet first' : 'Please connect your wallet first', 'error')
      return
    }

    if (isSolanaPost) {
      await sendSolanaHeart(liked)
      return
    }

    const target = resolveTarget()
    if (!target) return

    const { targetChain, chainDefinition, targetPublicClient } = target
    const functionName = liked ? 'batchLike' : 'unlike'
    const args = liked ? [address, [post.id]] : [address, post.id]
    const previousData = interactionState
    const nextCount = liked ? previousData.likeCount + 1 : Math.max(0, previousData.likeCount - 1)

    // The optimistic flip is the pending feedback — no loader swap, so the icon and
    // counter never jump while the action settles
    mutate({ isLiked: liked, likeCount: nextCount, isProcessing: true }, { revalidate: false })

    const settle = () => {
      // Pin the optimistic state past the cidex indexing lag so the revalidation cannot
      // flip the heart back
      markLikeOverride(actor, post.network_id, post.id, liked)
      mutate((prev) => ({ ...prev, isProcessing: false }), { revalidate: true })

      if (typeof onUpdate === 'function') {
        onUpdate(post.id, { is_liked: liked ? 1 : 0, total_likes: nextCount })
      }

      toast(liked ? 'Liked' : 'Like removed', 'success')
    }

    try {
      const session = await isSessionActive({ userAddress: address, publicClient: targetPublicClient })

      if (await tryGaslessHeart(functionName, args, target, session.active)) {
        settle()
        return
      }

      // The contract resolves the burner key back to the owner, so the session key signs
      // unlike() exactly like it signs batchLike() — and neither needs a wallet confirmation
      if (session.active) {
        await writeWithBurnerSession({
          chain: chainDefinition,
          contractAddress: targetChain.hup,
          abi,
          functionName,
          args,
        })

        settle()
        return
      }

      pendingActionRef.current = liked ? 'like' : 'unlike'

      await ensureWalletChain()
      await writeContractAsync({
        abi,
        chainId,
        address: targetChain.hup,
        functionName,
        args,
      })

      // The receipt effect above settles the state once the block lands
      toast(liked ? 'Confirming block execution...' : 'Removing like onchain...', 'success')
    } catch (err) {
      console.error(`${liked ? 'Like' : 'Unlike'} failed:`, err)
      pendingActionRef.current = null
      toast(shortTxError(err, liked ? 'Could not like post' : 'Could not remove like'), 'error')
      mutate(previousData, { revalidate: false })
    }
  }

  // ■■■ Derived Display State ■■■
  // A fresh optimistic override outranks the API snapshot: the indexer lags a
  // few blocks behind the tx, so raw revalidations briefly report stale data
  const likeOverride = getLikeOverride(likeOverridesMap, actor, post.network_id, post.id)
  const isLiked = likeOverride ? likeOverride.liked : interactionState.isLiked
  const likeCount =
    likeOverride && likeOverride.liked !== interactionState.isLiked
      ? Math.max(0, interactionState.likeCount + (likeOverride.liked ? 1 : -1))
      : interactionState.likeCount

  const handleLikeInteraction = (e) => {
    e.stopPropagation()

    if (!actorConnected) {
      toast(isSolanaPost ? 'Connect your Solana wallet' : 'Please connect wallet', 'error')
      return
    }

    if (isLiked) {
      sendHeart(false)
    } else if (isQueued) {
      removeFromBatch(actor, post.network_id, post.id)
    } else if (localStorage.getItem(localStorageBatchLikeKey) !== 'false') {
      addToBatch(actor, post.network_id, post.id)
    } else {
      sendHeart(true)
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

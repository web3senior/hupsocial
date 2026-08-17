'use client'

import { useEffect, useRef } from 'react'
import { QuotesIcon, RepeatIcon } from '@phosphor-icons/react'
import { useConnection, usePublicClient, useSignTypedData, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { getPublicClient } from 'wagmi/actions'
import { useClientMounted } from '@/hooks/useClientMount'
import { usePostStats } from '@/hooks/usePostStats'
import { toast } from '@/components/NextToast'
import { CONTRACTS, config } from '@/config/wagmi'
import { isSessionActive } from '@/lib/burnerSession'
import { gaslessCooldown, isGaslessEnabled, relayHupAction } from '@/lib/relayGasless'
import { ContentType, ZERO_ADDRESS } from '@/lib/content'
import abi from '@/abi/post.json'
import NativePopover from './NativePopover'
import Counter from './Counter'
import postStyles from '../Post.module.scss'

/**
 * Repost Interaction Component
 * @param {Object} props
 * @param {Object} props.post Core content model with network metadata and repost metrics.
 * @param {Function} [props.onQuote] Opens the quote composer for this post.
 */
export const Repost = ({ post, onQuote }) => {
  const isMounted = useClientMounted()
  const { address, isConnected } = useConnection()
  const publicClient = usePublicClient()
  const { signTypedDataAsync } = useSignTypedData()
  const { stats, mutate } = usePostStats(post)
  const lastActionRef = useRef(null)
  const { data: hash, isPending, mutateAsync: writeContractAsync } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  const repostCount = Number(stats?.total_reposts ?? stats?.repost_count) || 0
  const isReposted = stats?.has_reposted === 1 || stats?.has_reposted === true

  useEffect(() => {
    if (isConfirmed) {
      // No revalidation here: the click-time optimistic mutate already holds the right
      // numbers, and the indexer lags the receipt — an immediate refetch would return
      // the stale pre-repost row and wipe them.
      toast(lastActionRef.current === 'undo' ? 'Repost removed onchain!' : 'Repost saved onchain!', 'success')
    }
  }, [isConfirmed])

  const resolveHupAddress = () => {
    const targetChain = CONTRACTS[`chain${post.network_id}`]

    if (!targetChain?.hup) {
      toast('Contract configuration missing for network', 'error')
      return null
    }

    return targetChain.hup
  }

  /**
   * Relays the repost `create` through the forwarder so the tap costs the user nothing.
   * The relay route buckets it as a repost, not a post, by decoding the ContentType
   * argument. Returns false whenever the relay is unavailable — cooldown included —
   * leaving the tap on the usual wallet path, where the prompt is the consent to pay.
   * @param {Array} args Owner-first `create` args for the repost.
   * @returns {Promise<boolean>} Whether the repost went out sponsored.
   */
  const tryGaslessRepost = async (args) => {
    const chainId = Number(post.network_id)
    if (!isGaslessEnabled(chainId)) return false
    if (gaslessCooldown('create', chainId, address, args) > 0) return false

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
        functionName: 'create',
        args,
        signTypedDataAsync,
        useSessionKey: session.active,
      })

      return true
    } catch (err) {
      if (err.code === 'RELAY_COOLDOWN') {
        toast('Free-repost allowance is used up for now — using your wallet instead.', 'info')
      } else {
        console.warn('Gasless repost unavailable:', err.message)
      }
      return false
    }
  }

  const repost = async (id) => {
    const hupAddress = resolveHupAddress()
    if (!hupAddress) return

    const previousData = stats

    try {
      lastActionRef.current = 'repost'
      mutate(
        (prev) => ({
          ...prev,
          total_reposts: (Number(prev?.total_reposts) || 0) + 1,
          has_reposted: 1,
        }),
        { revalidate: false },
      )

      // Owner-first for the relay — attribution flows through _resolveActor both for a
      // session key and for a wallet signing for itself. The wallet fallback below keeps
      // its ZERO_ADDRESS direct-call form.
      if (await tryGaslessRepost([address, ContentType.Repost, '', BigInt(id), false])) {
        toast('Reposted — gas covered by Hup!', 'success')
        return
      }

      await writeContractAsync({
        abi,
        address: hupAddress,
        functionName: 'create',
        args: [
          ZERO_ADDRESS, // direct wallet call, not session owner
          ContentType.Repost,
          '', // reposts carry no metadata
          BigInt(id), // parent post id
          false, // reposts never allow comments
        ],
      })

      toast('Confirming block execution...', 'success')
    } catch (err) {
      console.error('Repost failed:', err)
      toast(err.shortMessage || err.message || 'Transaction rejected or encountered an error.', 'error')
      mutate(previousData, { revalidate: false })
    }
  }

  const removeRepost = async () => {
    const hupAddress = resolveHupAddress()
    if (!hupAddress) return

    // Undoing means deleting the viewer's own repost row onchain, so its content id
    // must already be resolvable through the indexer.
    const repostRowId = stats?.viewer_repost_id
    if (!repostRowId) {
      toast('Repost is still confirming — try again shortly', 'error')
      return
    }

    const previousData = stats

    try {
      lastActionRef.current = 'undo'
      mutate(
        (prev) => ({
          ...prev,
          total_reposts: Math.max(0, (Number(prev?.total_reposts) || 0) - 1),
          has_reposted: 0,
          viewer_repost_id: null,
        }),
        { revalidate: false },
      )

      await writeContractAsync({
        abi,
        address: hupAddress,
        functionName: 'deleteContent',
        args: [
          ZERO_ADDRESS, // direct wallet call, not session owner
          BigInt(repostRowId),
        ],
      })

      toast('Confirming block execution...', 'success')
    } catch (err) {
      console.error('Undo repost failed:', err)
      toast(err.shortMessage || err.message || 'Transaction rejected or encountered an error.', 'error')
      mutate(previousData, { revalidate: false })
    }
  }

  if (!isMounted) return null

  return (
    <NativePopover
      placement="bottom-start"
      trigger={
        <button data-action="repost" aria-label="Repost" disabled={isPending || isConfirming} onClick={(e) => e.stopPropagation()}>
          <RepeatIcon width={20} height={20} />
          {repostCount > 0 && <Counter value={repostCount} />}
        </button>
      }
    >
      {({ close }) => (
        <div className={postStyles.post__repostMenu}>
          <button
            className={postStyles.post__repostMenu__option}
            onClick={(e) => {
              e.stopPropagation()
              close()
              if (!isConnected) {
                toast(`Please connect wallet`, `error`)
                return
              }
              isReposted ? removeRepost() : repost(post.id)
            }}
          >
            <span>{isReposted ? `Undo repost` : `Repost`}</span>
            <RepeatIcon width={17} height={17} />
          </button>
          <button
            className={postStyles.post__repostMenu__option}
            onClick={(e) => {
              e.stopPropagation()
              close()
              if (!isConnected) {
                toast(`Please connect wallet`, `error`)
                return
              }
              onQuote?.()
            }}
          >
            <span>{`Quote`}</span>
            <QuotesIcon width={17} height={17} />
          </button>
        </div>
      )}
    </NativePopover>
  )
}

export default Repost

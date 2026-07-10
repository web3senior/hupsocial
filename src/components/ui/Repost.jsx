'use client'

import { useEffect, useRef } from 'react'
import { QuotesIcon, RepeatIcon } from '@phosphor-icons/react'
import { useConnection, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { useClientMounted } from '@/hooks/useClientMount'
import { usePostStats } from '@/hooks/usePostStats'
import { toast } from '@/components/NextToast'
import { CONTRACTS } from '@/config/wagmi'
import { ContentType, ZERO_ADDRESS } from '@/lib/content'
import abi from '@/abi/post.json'
import NativePopover from './NativePopover'
import postStyles from '../Post.module.scss'
import styles from './Counter.module.scss'

/**
 * Repost Interaction Component
 * @param {Object} props
 * @param {Object} props.post Core content model with network metadata and repost metrics.
 * @param {Function} [props.onQuote] Opens the quote composer for this post.
 */
export const Repost = ({ post, onQuote }) => {
  const isMounted = useClientMounted()
  const { isConnected } = useConnection()
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
          {repostCount > 0 && (
            <div className={styles.counterWrapper}>
              <span key={repostCount} className={styles.counterNumber}>
                {repostCount}
              </span>
            </div>
          )}
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

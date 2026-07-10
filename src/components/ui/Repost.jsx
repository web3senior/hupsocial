'use client'

import { useEffect, useState } from 'react'
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
  const [isReposted, setIsReposted] = useState(false)
  const { stats, mutate } = usePostStats(post)
  const { data: hash, isPending, mutate: writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  const repostCount = Number(stats?.total_reposts ?? stats?.repost_count) || 0

  useEffect(() => {
    if (isConfirmed) {
      mutate(
        (prev) => ({
          ...prev,
          total_reposts: (Number(prev?.total_reposts) || 0) + 1,
        }),
        { revalidate: true },
      )
      toast('Repost saved onchain!', 'success')
    }
  }, [isConfirmed])

  const repost = (e, id) => {
    e.stopPropagation()

    if (!isConnected) {
      toast('Please connect your wallet first', 'error')
      return
    }

    const targetChain = CONTRACTS[`chain${post.network_id}`]

    if (!targetChain?.hup) {
      toast('Contract configuration missing for network', 'error')
      return
    }

    writeContract({
      abi,
      address: targetChain.hup,
      functionName: 'create',
      args: [
        ZERO_ADDRESS, // direct wallet call, not session owner
        ContentType.Repost,
        '', // repost metadata can be empty
        BigInt(id), // parent post id
        false, //false for all reposts
      ],
    })
  }

  const removeRepost = (e, id) => {
    e.stopPropagation()

    if (!isConnected) {
      toast('Please connect your wallet first', 'error')
      return
    }

    const targetChain = CONTRACTS[`chain${post.network_id}`]

    if (!targetChain?.hup) {
      toast('Contract configuration missing for network', 'error')
      return
    }

    writeContract({
      abi,
      address: targetChain.hup,
      functionName: 'removeRepost',
      args: [id],
    })
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
              isReposted ? removeRepost(e, post.id) : repost(e, post.id)
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

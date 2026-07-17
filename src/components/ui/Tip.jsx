'use client'

import { useConnection } from 'wagmi'
import { useClientMounted } from '@/hooks/useClientMount'
import { usePostStats } from '@/hooks/usePostStats'
import { toast } from '@/components/NextToast'
import { TipIcon } from '@/components/Icons'
import styles from './Counter.module.scss'

/**
 * Tip Interaction Component
 * Counter reads total_tips from the shared post stats (indexed from HupTipper's Tipped
 * events by cidex); the TipModal mutates the same stats key after a confirmed tip.
 * @param {Object} props
 * @param {Object} props.post Core content model with network metadata.
 * @param {Function} props.onTip Opens the tip modal for this post.
 */
export const Tip = ({ post, onTip }) => {
  const isMounted = useClientMounted()
  const { isConnected } = useConnection()
  const { stats } = usePostStats(post)

  const tipCount = Number(stats?.total_tips) || 0

  const handleTip = (e) => {
    e.stopPropagation()

    if (!isConnected) {
      toast(`Please connect wallet`, `error`)
      return
    }

    onTip?.(post)
  }

  if (!isMounted) return null

  return (
    <button data-action="tip" aria-label="Tip the author" onClick={handleTip}>
      <TipIcon />
      {tipCount > 0 && (
        <div className={styles.counterWrapper}>
          <span key={tipCount} className={styles.counterNumber}>
            {new Intl.NumberFormat('en', {
              notation: 'compact',
              maximumFractionDigits: 1,
            }).format(tipCount)}
          </span>
        </div>
      )}
    </button>
  )
}

export default Tip

'use client'

import { useConnection } from 'wagmi'
import { useClientMounted } from '@/hooks/useClientMount'
import { usePostStats } from '@/hooks/usePostStats'
import { toast } from '@/components/NextToast'
import { TipIcon } from '@/components/Icons'
import Counter from './Counter'
import Tooltip from './Tooltip'

const compactUsd = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })
const plainUsd = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
// Sub-cent tips are the norm on a young network — significant digits keep $0.004 readable
// instead of rounding a real tip down to "$0.00" or hiding it behind a "<$0.01".
const tinyUsd = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', maximumSignificantDigits: 2 })

/** Earned dollars for the badge: compact past 1k, significant digits under a cent. */
const formatEarned = (usd) => (usd >= 1000 ? compactUsd : usd >= 0.01 ? plainUsd : tinyUsd).format(usd)

const compactCount = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

/**
 * Tip Interaction Component
 * The badge shows what the post earned (tips_usd, summed per token by the API from the
 * cidex-indexed tips table and priced at read time). Prices are best effort — on a chain
 * with no market price the badge falls back to the tip count, which is what it always was.
 * The TipModal mutates the same stats key after a confirmed tip.
 * @param {Object} props
 * @param {Object} props.post Core content model with network metadata.
 * @param {Function} props.onTip Opens the tip modal for this post.
 */
export const Tip = ({ post, onTip }) => {
  const isMounted = useClientMounted()
  const { isConnected } = useConnection()
  const { stats } = usePostStats(post)

  const tipCount = Number(stats?.total_tips) || 0
  const earnedUsd = Number(stats?.tips_usd) || 0
  const hasEarned = earnedUsd > 0

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
    <Tooltip
      content={hasEarned ? `Earned ${formatEarned(earnedUsd)} from ${tipCount} ${tipCount === 1 ? 'tip' : 'tips'}` : 'Tip creator'}
      placement="bottom"
      size="compact"
      hoverOnly
    >
      <button data-action="tip" data-earned={hasEarned || undefined} aria-label="Tip the author" onClick={handleTip}>
        <TipIcon />
        {hasEarned ? (
          // Keyed on the dollar figure so the counter replays its slide-up when a tip lands,
          // not on every price tick that leaves the rounded label unchanged.
          <Counter value={formatEarned(earnedUsd)}>+{formatEarned(earnedUsd)}</Counter>
        ) : (
          tipCount > 0 && <Counter value={tipCount}>{compactCount.format(tipCount)}</Counter>
        )}
      </button>
    </Tooltip>
  )
}

export default Tip

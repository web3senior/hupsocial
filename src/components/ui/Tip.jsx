'use client'

import { useEffect, useRef, useState } from 'react'
import { useConnection } from 'wagmi'
import { useClientMounted } from '@/hooks/useClientMount'
import { usePostStats } from '@/hooks/usePostStats'
import { toast } from '@/components/NextToast'
import { TipIcon } from '@/components/Icons'
import Counter from './Counter'
import Tooltip from './Tooltip'
import styles from './Tip.module.scss'

const compactUsd = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })
const plainUsd = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
// Sub-cent tips are the norm on a young network — significant digits keep $0.004 readable
// instead of rounding a real tip down to "$0.00" or hiding it behind a "<$0.01".
const tinyUsd = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', maximumSignificantDigits: 2 })

/** Earned dollars for the badge: compact past 1k, significant digits under a cent. */
const formatEarned = (usd) => (usd >= 1000 ? compactUsd : usd >= 0.01 ? plainUsd : tinyUsd).format(usd)

const compactCount = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const compactToken = new Intl.NumberFormat('en', { notation: 'compact', maximumSignificantDigits: 3 })

/** Soul label for the last tip: dollars when priced, token amount on unpriced chains. */
const formatLastTip = (lastTip) => {
  if (lastTip?.usd > 0) return formatEarned(lastTip.usd)
  if (lastTip?.amount > 0 && lastTip.symbol) return `${compactToken.format(lastTip.amount)} ${lastTip.symbol}`
  return null
}

// Souls already released this page load, keyed by post AND label — scrolling back past a
// post stays quiet, but a genuinely new tip landing live (the label changes) replays it.
const playedSouls = new Set()

/**
 * Tip Interaction Component
 * The badge shows what the post earned (tips_usd, summed per token by the API from the
 * cidex-indexed tips table and priced at read time). Prices are best effort — on a chain
 * with no market price the badge falls back to the tip count, which is what it always was.
 * The TipModal mutates the same stats key after a confirmed tip.
 * When the post settles into view, the most recent tip (last_tip from the same API
 * helper) rises out of the badge and dissolves — once per post per page load.
 * @param {Object} props
 * @param {Object} props.post Core content model with network metadata.
 * @param {Function} props.onTip Opens the tip modal for this post.
 */
export const Tip = ({ post, onTip }) => {
  const isMounted = useClientMounted()
  const { isConnected } = useConnection()
  const { stats } = usePostStats(post)
  const buttonRef = useRef(null)
  const [soul, setSoul] = useState(null)

  const tipCount = Number(stats?.total_tips) || 0
  const earnedUsd = Number(stats?.tips_usd) || 0
  const hasEarned = earnedUsd > 0

  const soulLabel = formatLastTip(stats?.last_tip)
  const soulKey = soulLabel ? `${post.network_id}:${post.id}:${soulLabel}` : null

  // Release the soul when the reader actually lands on the post: 60% of the button in
  // view held for a beat, so souls don't stream out of every card during a fast scroll.
  useEffect(() => {
    const node = buttonRef.current
    if (!node || !soulKey || playedSouls.has(soulKey) || typeof IntersectionObserver === 'undefined') return

    let dwellTimer
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          dwellTimer = setTimeout(() => {
            playedSouls.add(soulKey)
            setSoul(soulLabel)
            observer.disconnect()
          }, 450)
        } else {
          clearTimeout(dwellTimer)
        }
      },
      { threshold: 0.6 },
    )
    observer.observe(node)

    return () => {
      clearTimeout(dwellTimer)
      observer.disconnect()
    }
    // isMounted: the button doesn't exist on the first (pre-mount) render, so the
    // effect must re-run once it does or the observer never attaches.
  }, [isMounted, soulKey, soulLabel])

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
      // Tooltip clones the child with its own ref, so the button ref must ride the
      // Tooltip's forwarded ref to reach the real trigger node.
      ref={buttonRef}
      content={hasEarned ? `Earned ${formatEarned(earnedUsd)} from ${tipCount} ${tipCount === 1 ? 'tip' : 'tips'}` : 'Tip creator'}
      placement="bottom"
      size="compact"
      hoverOnly
    >
      <button data-action="tip" data-earned={hasEarned || undefined} aria-label="Tip the author" onClick={handleTip}>
        {/* The soul rises from the icon — the body — so both share one positioning anchor */}
        <span className={styles.tipSoulAnchor}>
          <TipIcon />
          {soul && (
            <span className={styles.tipSoul} aria-hidden="true" onAnimationEnd={() => setSoul(null)}>
              +{soul}
            </span>
          )}
        </span>
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

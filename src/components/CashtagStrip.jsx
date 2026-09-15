'use client'

import clsx from 'clsx'
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react'
import { useCashtags } from '@/hooks/useCashtags'
import { useStripScroll } from '@/hooks/useStripScroll'
import CashtagCard, { CashtagCardSkeleton } from './CashtagCard'
import styles from './CashtagStrip.module.scss'

/**
 * Cashtag Strip
 * The cards under a post, one per cashtag, scrolling sideways when there is more than one.
 *
 * Native overflow scrolling rather than a carousel library, with the wheel translation and the
 * hover arrows coming from useStripScroll — the same behaviour the drops rail rides on. Embla
 * still earns its keep in the media gallery, which needs paging.
 */
const CashtagStrip = ({ text, cashtags }) => {
  const { tokens, symbols, isLoading } = useCashtags(text, cashtags)
  const { trackRef, edges, nudge } = useStripScroll(tokens.length)

  // Nothing quoted and nothing coming: the post named no token the app can vouch for, or the
  // API vouched for none of the ones it did
  if (tokens.length === 0 && !isLoading) return null

  // Placeholders while the first quotes are in flight. What makes these safe is that the
  // symbols are known synchronously — they are read straight out of the post's own text — so
  // the strip reserves exactly the cards it is about to draw, at exactly their height, and the
  // row fills in where it stood instead of shoving the feed down as prices land.
  if (tokens.length === 0) {
    return (
      <div className={styles.cashtagStrip} aria-hidden="true">
        <div className={styles.cashtagStrip__track}>
          {symbols.map((symbol) => (
            <CashtagCardSkeleton key={symbol} wide={symbols.length === 1} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      className={styles.cashtagStrip}
      // The strip lives inside a card that opens the thread on click
      onClick={(event) => event.stopPropagation()}
    >
      <div ref={trackRef} className={styles.cashtagStrip__track} role="group" aria-label="Token prices mentioned in this post">
        {/* A single card has nothing to scroll past, so it takes the post's full width. The
            fixed pill width only exists to let the next card peek in and advertise the scroll. */}
        {tokens.map((token) => (
          <CashtagCard key={token.symbol} token={token} wide={tokens.length === 1} />
        ))}
      </div>

      {/* Hidden from assistive tech: the track itself is already a keyboard-scrollable region,
          so these would only add duplicate stops */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        className={clsx(styles.cashtagStrip__arrow, styles['cashtagStrip__arrow--start'], edges.start && styles['cashtagStrip__arrow--hidden'])}
        onClick={() => nudge(-1)}
      >
        <CaretLeftIcon size={14} weight="bold" />
      </button>
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        className={clsx(styles.cashtagStrip__arrow, styles['cashtagStrip__arrow--end'], edges.end && styles['cashtagStrip__arrow--hidden'])}
        onClick={() => nudge(1)}
      >
        <CaretRightIcon size={14} weight="bold" />
      </button>
    </div>
  )
}

export default CashtagStrip

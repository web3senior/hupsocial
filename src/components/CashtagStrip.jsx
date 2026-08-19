'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react'
import { useCashtags } from '@/hooks/useCashtags'
import CashtagCard from './CashtagCard'
import styles from './CashtagStrip.module.scss'

// Below this the strip is at an end, and the wheel belongs to the page again
const EDGE_SLOP_PX = 2

/**
 * Cashtag Strip
 * The cards under a post, one per cashtag, scrolling sideways when there is more than one.
 *
 * Native overflow scrolling rather than a carousel library: this sits inside a vertically
 * scrolling feed, where a JS-driven track fights the browser for every touch gesture, and
 * momentum and rubber-banding come free from the platform. Embla still earns its keep in the
 * media gallery, which needs paging.
 *
 * A mouse, though, has no way into a horizontal scroller — a wheel only emits deltaY, and the
 * scrollbar is hidden — so the wheel is translated here and arrows appear on pointers that can
 * hover. Touch needs neither and gets neither.
 */
const CashtagStrip = ({ text, cashtags }) => {
  const { tokens } = useCashtags(text, cashtags)
  const trackRef = useRef(null)
  const [edges, setEdges] = useState({ start: true, end: true })

  const measure = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setEdges({ start: el.scrollLeft <= EDGE_SLOP_PX, end: el.scrollLeft >= max - EDGE_SLOP_PX })
  }, [])

  useEffect(() => {
    const el = trackRef.current
    if (!el) return

    // Non-passive, and bound natively: React registers wheel as passive at the root, where
    // preventDefault is a no-op and the page scrolls away underneath the strip
    const onWheel = (event) => {
      // A trackpad's sideways swipe already arrives as deltaX and needs no help
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      const max = el.scrollWidth - el.clientWidth
      if (max <= 0) return
      // Hand the gesture back to the page at either end, so a scroll down the feed does not
      // dead-end on a card
      const atEnd = event.deltaY > 0 ? el.scrollLeft >= max - EDGE_SLOP_PX : el.scrollLeft <= EDGE_SLOP_PX
      if (atEnd) return
      event.preventDefault()
      el.scrollLeft += event.deltaY
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('scroll', measure, { passive: true })
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(el)

    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [measure, tokens.length])

  const nudge = (direction) => {
    const el = trackRef.current
    if (!el) return

    // Step to the next card's own edge rather than by a fraction of the viewport. A proportional
    // nudge overshot — 80% of a 555px track is 444px against a 348px card — and the snap then
    // settled it at the far end, so one press skipped straight past the second card.
    // Measured from rects so this does not depend on which ancestor happens to be positioned.
    const trackLeft = el.getBoundingClientRect().left
    const offsets = [...el.children].map((card) => Math.round(card.getBoundingClientRect().left - trackLeft))

    const step = direction > 0 ? offsets.find((offset) => offset > EDGE_SLOP_PX) : [...offsets].reverse().find((offset) => offset < -EDGE_SLOP_PX)
    // No card that way means the last one is already flush; ride to the end so the final card
    // is not left clipped by whatever remainder is in play
    el.scrollBy({ left: step ?? direction * el.clientWidth, behavior: 'smooth' })
  }

  // Renders nothing until there is something real to show — a skeleton here would make every
  // post in the feed jump as prices land
  if (tokens.length === 0) return null

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

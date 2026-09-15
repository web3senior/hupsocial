'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Below this the strip is at an end, and the wheel belongs to the page again
const EDGE_SLOP_PX = 2

/**
 * Sideways scrolling for a row of cards inside a vertically scrolling page.
 *
 * Native overflow rather than a carousel library: a JS-driven track fights the browser for every
 * touch gesture, and momentum and rubber-banding come free from the platform. A mouse, though,
 * has no way into a horizontal scroller — a wheel only emits deltaY, and the scrollbar is hidden —
 * so the wheel is translated here and the caller draws arrows for pointers that can hover.
 *
 * @param {*} [contentKey] Changes whenever the cards do, so the edges are re-measured.
 * @returns {{trackRef: Object, edges: {start: boolean, end: boolean}, nudge: Function}}
 */
export function useStripScroll(contentKey) {
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
  }, [measure, contentKey])

  const nudge = useCallback((direction) => {
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
  }, [])

  return { trackRef, edges, nudge }
}

export default useStripScroll

'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// How long a restored feed keeps correcting itself back onto the reader's post and holding every
// card at its exit height. Covers the window where media and async card content resolve.
const RESTORE_SETTLE_MS = 2500

const CARD_SELECTOR = '[data-post-key]'

const cardSelector = (key) => `[data-post-key="${CSS.escape(key)}"]`

// The first card still showing any part of itself is the one the reader is on.
const findAnchor = (container) => {
  for (const card of container.querySelectorAll(CARD_SELECTOR)) {
    const { top, bottom } = card.getBoundingClientRect()
    if (bottom > 0) return { key: card.dataset.postKey, offset: Math.round(top) }
  }
  return null
}

const measureExit = (container) => {
  if (!container?.isConnected) return null

  const cardHeights = {}
  let anchor = null
  for (const card of container.querySelectorAll(CARD_SELECTOR)) {
    const rect = card.getBoundingClientRect()
    cardHeights[card.dataset.postKey] = Math.round(rect.height)
    if (!anchor && rect.bottom > 0) anchor = { key: card.dataset.postKey, offset: Math.round(rect.top) }
  }

  return { anchor, cardHeights, feedHeight: container.offsetHeight, feedWidth: container.offsetWidth, scrollY: window.scrollY }
}

/**
 * Puts a card feed back where the reader left it after an unmount/remount.
 *
 * While mounted it tracks the reader's place live: scroll offset, the anchor card and where it
 * sat in the viewport. `snapshot()` hands that to the caller's cache on exit, together with every
 * card's rendered height. On a remount with a snapshot, those heights go back onto the cards as
 * min-heights (`cardStyle`) so nothing can reflow while media and async card content resolve, and
 * a pre-paint loop keeps the anchor card at its old offset until the page has been still past the
 * settle window. Settling releases the reservations in one synchronous step and scrolls by
 * whatever that shrank above the anchor, so the release itself never shows.
 *
 * Cards are the `data-post-key` elements inside `containerRef`.
 *
 * @param {{ containerRef: import('react').RefObject<HTMLElement>, restore?: object|null, ready?: boolean }} options
 *   `restore` is a previous `snapshot()` (extra fields are ignored); `ready` flips true once the
 *   restored cards are in the tree.
 */
export function useFeedScrollRestore({ containerRef, restore = null, ready = false }) {
  // Tracked live: reading these inside the unmount cleanup is too late, the browser or Next may
  // already have moved the page for the incoming route.
  const lastScrollYRef = useRef(restore?.scrollY ?? 0)
  const lastAnchorRef = useRef(restore?.anchor ?? null)
  const lastFeedHeightRef = useRef(restore?.feedHeight ?? 0)
  const lastFeedWidthRef = useRef(restore?.feedWidth ?? 0)
  // Consumed only by settle(); a StrictMode remount restarts the loop from it.
  const pendingRef = useRef(restore ? { scrollY: restore.scrollY ?? 0, anchor: restore.anchor ?? null } : null)
  const exitRef = useRef(null)

  const [reserved, setReserved] = useState(() =>
    restore ? { feed: restore.feedHeight ?? null, cards: restore.cardHeights ?? null, width: restore.feedWidth ?? null } : null,
  )
  const reservedRef = useRef(reserved)
  useEffect(() => {
    reservedRef.current = reserved
  }, [reserved])

  useEffect(() => {
    // Measured on a frame rather than per scroll event: this walks the cards, and the events fire
    // far denser than paints.
    let frame = 0
    const measure = () => {
      frame = 0
      const container = containerRef.current
      if (!container) return
      lastFeedHeightRef.current = container.offsetHeight || lastFeedHeightRef.current
      lastFeedWidthRef.current = container.offsetWidth || lastFeedWidthRef.current
      const anchor = findAnchor(container)
      if (anchor) lastAnchorRef.current = anchor
    }

    const handleScroll = () => {
      lastScrollYRef.current = window.scrollY
      if (!frame) frame = requestAnimationFrame(measure)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [containerRef])

  // Layout cleanups run while the DOM is still attached, so the cards can be measured as the
  // reader last saw them; the passive cleanup where callers save runs after the nodes are gone.
  useLayoutEffect(() => {
    const container = containerRef.current
    return () => {
      exitRef.current = measureExit(container)
    }
  }, [containerRef])

  const snapshot = useCallback(() => {
    const exit = exitRef.current
    exitRef.current = null
    // A back/forward pop moves the page before the old route unmounts. An exit measured at a
    // different offset than the reader's last scroll keeps only its scroll-independent parts.
    const unmoved = exit !== null && Math.abs(exit.scrollY - lastScrollYRef.current) < 1

    return {
      scrollY: lastScrollYRef.current,
      anchor: (unmoved && exit.anchor) || lastAnchorRef.current,
      feedHeight: exit?.feedHeight || lastFeedHeightRef.current || null,
      feedWidth: exit?.feedWidth || lastFeedWidthRef.current || null,
      cardHeights: exit?.cardHeights ?? null,
    }
  }, [])

  // Drops the per-card reservations without letting the reader see it: the styles come off the
  // DOM directly, the anchor is re-measured in the same task, and the page scrolls by the shrink.
  // React's next render only agrees with what is already there.
  const releaseCards = useCallback(() => {
    const container = containerRef.current
    if (reservedRef.current?.cards && container) {
      const anchor = lastAnchorRef.current
      const card = anchor ? container.querySelector(cardSelector(anchor.key)) : null
      const before = card ? card.getBoundingClientRect().top : 0

      for (const element of container.querySelectorAll(CARD_SELECTOR)) element.style.minHeight = ''

      if (card) {
        const delta = card.getBoundingClientRect().top - before
        if (Math.abs(delta) >= 1) window.scrollBy({ top: delta, behavior: 'instant' })
      }
    }
    setReserved((prev) => (prev?.cards ? { ...prev, cards: null } : prev))
  }, [containerRef])

  // Heights only mean anything at the width they were measured at (a rotated phone, a resized
  // window). Decided before the first paint so the wrong reservations never show.
  useLayoutEffect(() => {
    const container = containerRef.current
    const width = reservedRef.current?.width
    if (!container || !reservedRef.current?.cards || !width) return
    if (Math.abs(container.offsetWidth - width) > 1) setReserved((prev) => (prev ? { ...prev, cards: null } : prev))
  }, [containerRef])

  // Restore the reader's place once the hydrated cards have rendered.
  //
  // Reaching the target once is not enough to stop. Next's layout-router scrolls the new segment
  // to top AFTER this effect (parent layout effects run after children's), and whatever the card
  // reservations do not cover still streams in afterwards. So the loop corrects toward the ANCHOR
  // card for as long as the page is still moving, falling back to the raw offset when that card is
  // not in the restored list. rAF callbacks fire before the pending paint, so each correction lands
  // pre-paint and never shows.
  useLayoutEffect(() => {
    const pending = pendingRef.current
    if (!pending || !ready) return

    const deadline = performance.now() + RESTORE_SETTLE_MS
    let frame = 0
    let stableFrames = 0

    // Detaching is NOT the same as consuming: only settle() clears the pending restore, so a
    // StrictMode double-invoke restarts the loop instead of silently leaving the feed at the top.
    function teardown() {
      window.removeEventListener('wheel', settle)
      window.removeEventListener('touchstart', settle)
      window.removeEventListener('keydown', settle)
      cancelAnimationFrame(frame)
    }

    function settle() {
      pendingRef.current = null
      teardown()
      releaseCards()
    }

    // How far the page has drifted from where the reader left it, in pixels to scroll by.
    const drift = () => {
      if (pending.anchor) {
        const card = containerRef.current?.querySelector(cardSelector(pending.anchor.key))
        if (card) return card.getBoundingClientRect().top - pending.anchor.offset
      }
      return pending.scrollY - window.scrollY
    }

    const apply = () => {
      const delta = drift()

      if (Math.abs(delta) < 2) {
        stableFrames += 1
      } else {
        stableFrames = 0
        // 'instant' overrides the app's global scroll-behavior: smooth, which would animate the
        // correction into a visible crawl.
        window.scrollTo({ top: window.scrollY + delta, behavior: 'instant' })
      }

      // Hold past the first stable frames: content that has not started loading yet will move the
      // page again. The deadline, not stability, is what ends this.
      if (performance.now() > deadline && stableFrames >= 2) {
        settle()
        return
      }
      frame = requestAnimationFrame(apply)
    }

    // The reader touching the page outranks the restore: never fight a deliberate scroll.
    window.addEventListener('wheel', settle, { passive: true, once: true })
    window.addEventListener('touchstart', settle, { passive: true, once: true })
    window.addEventListener('keydown', settle, { once: true })
    apply()

    return teardown
  }, [ready, containerRef, releaseCards])

  const clearReservations = useCallback(() => setReserved(null), [])

  const cardStyle = useCallback(
    (key) => {
      const height = reserved?.cards?.[key]
      return height ? { minHeight: height } : undefined
    },
    [reserved],
  )

  // The container keeps its exit height until the list is replaced: media that has not loaded
  // leaves the document too short for the scroll target, and the browser clamps scrollTo.
  const containerStyle = reserved?.feed ? { minHeight: reserved.feed } : undefined

  return { snapshot, containerStyle, cardStyle, clearReservations }
}

'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

// Gesture tuning for the auto-dim. Below the jitter floor a scroll is trackpad noise or a
// rubber-band settle; above the jump ceiling it is not a gesture at all but a restored or
// anchored position, which must not flick the chrome away.
const SCROLL_JITTER = 8
const SCROLL_JUMP = 300
// The chrome always shows this close to the top, so a page opens with it in view
const SCROLL_REVEAL_ZONE = 64

/**
 * True while the reader browses downward, false on the way back up or near the top. Shared by
 * the header and footer nav so both bars dim and return together.
 */
export function useScrollDim() {
  const [isDimmed, setIsDimmed] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    let lastY = window.scrollY
    let frame = 0

    const evaluate = () => {
      frame = 0
      const y = window.scrollY
      const delta = y - lastY

      // A cached feed position replayed on return (tabs/HomeFeedTab) or an anchor jump lands as
      // one huge delta. Re-anchor on it, but read no intent into it.
      if (Math.abs(delta) > SCROLL_JUMP) {
        lastY = y
        return
      }

      // Hold the anchor through sub-threshold moves so a slow drag still accumulates into one
      if (Math.abs(delta) < SCROLL_JITTER) return

      setIsDimmed(delta > 0 && y > SCROLL_REVEAL_ZONE)
      lastY = y
    }

    // Scroll fires far faster than paint; collapse a burst into the one frame that shows
    const handleScroll = () => {
      if (!frame) frame = requestAnimationFrame(evaluate)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      window.removeEventListener('scroll', handleScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  // A new route starts at the top, so the chrome owes the user a clean slate. Reset during
  // render (not in an effect) so the dimmed frame never paints on the new route.
  const [lastPathname, setLastPathname] = useState(pathname)
  if (lastPathname !== pathname) {
    setLastPathname(pathname)
    setIsDimmed(false)
  }

  return isDimmed
}

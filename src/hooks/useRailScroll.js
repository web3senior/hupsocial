'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Tracks which way a horizontal rail can still scroll, so arrow buttons can disable at either
 * end — and hide entirely when everything already fits. A scrollbar is easy to miss on a
 * trackpad (hidden until it moves) and absent on touch, so without the arrows a rail with
 * twelve items reads as a rail with four. Shared by the NFT collections rail and the
 * community category chips.
 * @param {import('react').RefObject<HTMLElement>} railRef The scroll container.
 * @param {Array} deps Values whose change can alter the rail's content width.
 */
export default function useRailScroll(railRef, deps = []) {
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const measure = useCallback(() => {
    const rail = railRef.current
    if (!rail) return
    // A pixel of slack: subpixel layout can leave scrollWidth a fraction over clientWidth
    // on a rail that doesn't actually move
    setCanScrollLeft(rail.scrollLeft > 1)
    setCanScrollRight(rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 1)
  }, [railRef])

  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    measure()
    rail.addEventListener('scroll', measure, { passive: true })
    // Items resize at breakpoints and the container with the viewport
    const observer = new ResizeObserver(measure)
    observer.observe(rail)
    return () => {
      rail.removeEventListener('scroll', measure)
      observer.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps])

  // One viewport's worth minus a sliver, so the last item seen stays on screen as the first
  // of the next set — the eye keeps its place
  const scrollByPage = useCallback(
    (direction) => {
      const rail = railRef.current
      if (!rail) return
      rail.scrollBy({ left: direction * rail.clientWidth * 0.85, behavior: 'smooth' })
    },
    [railRef]
  )

  return { canScrollLeft, canScrollRight, scrollByPage }
}

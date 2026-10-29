'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { usePostOverlayStore, setPostOverlayHostMounted } from '@/stores/usePostOverlayStore'

const loadOverlay = () => import('./PostOverlay')
const PostOverlay = dynamic(loadOverlay)

/**
 * Wraps the route's page in <main> so a post can open over it in place (usePostOverlayStore).
 * The page stays mounted under `display: none` — its fetched pages, tab and position survive —
 * and the post renders in its slot. Open is derived, not stored: the overlay shows exactly while
 * the pathname is the entry's path, so back/forward and real navigations need no handling here.
 *
 * `display: contents` keeps the wrapper out of <main>'s grid while the page is showing.
 */
export default function PostOverlayHost({ children }) {
  const pathname = usePathname()
  const entry = usePostOverlayStore((state) => state.entry)
  const isOpen = Boolean(entry && pathname === entry.path)
  const wasOpenRef = useRef(false)
  const pageRef = useRef(null)

  useEffect(() => {
    setPostOverlayHostMounted(true)
    // Fetch the overlay's chunk while idle so the first tap renders without waiting on it
    const schedule = window.requestIdleCallback ?? ((callback) => setTimeout(callback, 1))
    schedule(() => loadOverlay())
    return () => setPostOverlayHostMounted(false)
  }, [])

  // Runs after the commit that swapped what is shown, before paint, so neither view flashes at
  // the other's offset. 'instant' overrides the app's global scroll-behavior: smooth.
  useLayoutEffect(() => {
    if (isOpen === wasOpenRef.current) return
    wasOpenRef.current = isOpen

    if (isOpen) {
      window.scrollTo({ top: 0, behavior: 'instant' })
      // Focus would otherwise stay on the tapped card, now inside the hidden page
      document.activeElement?.blur?.()
      return
    }

    // `display: none` cancelled the page's CSS animations and showing it again restarts them, so
    // every `animate fade` entrance (feed cards, page wrappers) replayed from opacity 0 on back.
    // The page is being restored, not entered: finish those before paint. Endless ones (spinners,
    // idle loops) have no end to jump to and carry on.
    document.getAnimations().forEach((animation) => {
      if (!pageRef.current?.contains(animation.effect?.target)) return
      if (!Number.isFinite(animation.effect.getComputedTiming().endTime)) return
      animation.finish()
    })

    // Only a return to the page it opened from gets that page's offset back; a navigation the
    // overlay made to somewhere else (a profile) starts wherever that route puts it
    if (entry && pathname === entry.fromPath) window.scrollTo({ top: entry.scrollY, behavior: 'instant' })
  }, [isOpen, pathname, entry])

  return (
    <>
      <div ref={pageRef} style={{ display: isOpen ? 'none' : 'contents' }}>
        {children}
      </div>
      {isOpen && <PostOverlay entry={entry} />}
    </>
  )
}

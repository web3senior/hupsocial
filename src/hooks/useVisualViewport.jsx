'use client'

/**
 * @file hooks/useVisualViewport.jsx
 * @description Mirrors the visual viewport onto CSS custom properties on <html>.
 *
 * The software keyboard shrinks the *visual* viewport, never the layout one — and a modal
 * <dialog> renders in the top layer, positioned against that layout viewport. So a sheet
 * sized in vh/dvh keeps its full-screen height with the keyboard open: its footer sits
 * behind the keys, and the scroll the browser does to reveal the caret slides its header
 * off the top. Neither `dvh` nor `env()` reports any of this; `visualViewport` is the only
 * source for it.
 *
 * Publishes, for as long as the hook is active:
 *   --visual-viewport-height  visible height, shrinking as the keyboard slides in
 *   --visual-viewport-top     how far the visual viewport sits down the layout viewport
 *
 * Both are cleared on unmount, so every consumer must carry its own fallback
 * (`var(--visual-viewport-height, 100dvh)`) for the unmounted, pre-paint, and
 * no-visualViewport cases.
 */

import { useEffect } from 'react'

export default function useVisualViewport(active = true) {
  useEffect(() => {
    const viewport = active ? window.visualViewport : null
    if (!viewport) return

    const root = document.documentElement
    let frame = 0

    const sync = () => {
      // iOS fires resize and scroll on every frame of the keyboard's slide-in animation;
      // coalescing to one rAF keeps the sheet from re-laying out a few dozen times
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        root.style.setProperty('--visual-viewport-height', `${viewport.height}px`)
        root.style.setProperty('--visual-viewport-top', `${viewport.offsetTop}px`)
      })
    }

    sync()
    viewport.addEventListener('resize', sync)
    // offsetTop only moves via scroll events — it is how iOS shifts the page to reveal the caret
    viewport.addEventListener('scroll', sync)

    return () => {
      cancelAnimationFrame(frame)
      viewport.removeEventListener('resize', sync)
      viewport.removeEventListener('scroll', sync)
      root.style.removeProperty('--visual-viewport-height')
      root.style.removeProperty('--visual-viewport-top')
    }
  }, [active])
}

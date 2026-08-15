'use client'

/**
 * Page scroll lock for anything that covers the page — modal dialogs, the gallery lightbox.
 *
 * The page scrolls on <html> (Globals.scss sets `overflow: hidden scroll`), so locking body
 * overflow does nothing. Globals.scss also sets `scrollbar-gutter: stable` there, which is
 * what keeps the scrollbar's track reserved once overflow goes hidden: documentElement's
 * clientWidth stays put, so neither in-flow content nor the position:fixed header (whose
 * containing block is derived from that same width) jumps sideways.
 *
 * Refcounted, because these nest — a confirm inside a composer, a lightbox inside a modal.
 * Only the outermost release restores the scroller.
 */
let locks = 0
let lockedScrollY = 0

export function lockPageScroll() {
  if (locks++ > 0) return
  const html = document.documentElement
  lockedScrollY = window.scrollY

  // Belt and braces for anything that ignores scrollbar-gutter: if the track was dropped
  // anyway, the root box just got wider — pad by exactly what it gained. Measured rather
  // than assumed, so it stays a no-op wherever the gutter did hold (and with the overlay
  // scrollbars that leave no track to begin with).
  //
  // The probe is body's rendered width, NOT html.clientWidth: with scrollbar-gutter: stable,
  // Chromium keeps the gutter reserved in layout when the scrollbar hides but still folds the
  // freed track back into clientWidth. A clientWidth probe reads that as reclaimed space and
  // pads for a shift that never happened — jolting the whole page left by a scrollbar width.
  // Body (width: auto in html's content box) only widens if layout truly reclaimed the track.
  const widthBefore = document.body.getBoundingClientRect().width
  html.style.overflowY = 'hidden'
  const reclaimed = document.body.getBoundingClientRect().width - widthBefore
  if (reclaimed > 0) html.style.paddingRight = `${reclaimed}px`
}

export function unlockPageScroll() {
  if (locks === 0 || --locks > 0) return
  const html = document.documentElement
  html.style.overflowY = ''
  html.style.paddingRight = ''
  // behavior:'instant' bypasses the global scroll-behavior:smooth, so the page snaps back
  // to where it was instead of animating there from the top.
  window.scrollTo({ top: lockedScrollY, left: 0, behavior: 'instant' })
}

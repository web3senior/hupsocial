'use client'

/**
 * Post and comment cards open their thread on click, but a click that only finishes a text
 * drag inside the card must not navigate.
 *
 * Reading `window.getSelection()` at click time cannot tell the two apart: card chrome is
 * `user-select: none`, so pressing on a card never collapses a selection made earlier
 * elsewhere on the page. The guard then keeps seeing that stale selection and swallows every
 * click on every card until the selection is cleared some other way. Comparing where the
 * pointer went down with where it came up is the signal that actually describes a drag.
 */

// Pointer travel below this is a press, not a drag — covers the jitter of a normal click.
const DRAG_SLOP_PX = 5

// Only one pointer interaction is in flight at a time, so a module-level origin keeps this
// usable inside `.map()` without a ref per card.
let pointerOrigin = null

export const rememberCardPointerDown = (event) => {
  pointerOrigin = { x: event.clientX, y: event.clientY }
}

export const isTextSelectionDrag = (event) => {
  const origin = pointerOrigin
  pointerOrigin = null

  // No recorded press (keyboard activation, synthetic click) — treat it as a plain click.
  if (!origin) return false

  return Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > DRAG_SLOP_PX
}

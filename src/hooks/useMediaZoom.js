'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const MIN_SCALE = 1
const MAX_SCALE = 6
const TAP_SCALE = 2.5
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_SLOP = 30 // px between two taps that still counts as one double tap
const SPRING_BACK_SCALE = 1.05 // pinching out to roughly 1x snaps back to fit
const DRAG_SLOP = 3

const IDENTITY = { scale: MIN_SCALE, x: 0, y: 0 }

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const distanceBetween = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
const midpointOf = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 })

/**
 * Zoom and pan gestures for a single media element inside a scrolling viewer:
 * pinch and double-tap on touch, wheel and double-click with a pointer, drag to
 * pan once zoomed. Listeners are bound natively with `{ passive: false }` because
 * React registers wheel/touch handlers as passive at the root, which makes
 * `preventDefault()` a no-op and lets the page scroll mid-gesture.
 * The zoom is expressed as a transform on the target, so nothing reflows.
 * @param {Object} params
 * @param {React.RefObject<HTMLElement>} params.containerRef Full-bleed viewer root. Gestures bind
 *   here rather than on the media's scroller so a finger on a nav control still counts, and its box
 *   is the frame the pan is clamped to.
 * @param {boolean} [params.enabled=true] Bind listeners (e.g. only while the viewer shows a zoomable item).
 * @param {*} [params.resetKey] Zoom returns to 1x whenever this changes — pass the visible slide index.
 * @returns {{targetRef: Function, style: Object, isZoomed: boolean, zoomedRef: React.RefObject<boolean>, reset: Function}}
 */
export default function useMediaZoom({ containerRef, enabled = true, resetKey } = {}) {
  const targetRef = useRef(null)
  const stateRef = useRef(IDENTITY)
  const zoomedRef = useRef(false)
  const [state, setState] = useState(IDENTITY)
  const [animated, setAnimated] = useState(false)

  // Gestures run at pointer rate, so handlers read/write stateRef and only push
  // to React state for the render; zoomedRef lets other listeners branch cheaply.
  const apply = useCallback((next, animate = false) => {
    stateRef.current = next
    zoomedRef.current = next.scale > MIN_SCALE
    setAnimated(animate)
    setState(next)
  }, [])

  const reset = useCallback((animate = true) => apply(IDENTITY, animate), [apply])

  // A new slide (or a closed viewer) always starts unzoomed. Adjusting during
  // render rather than in an effect keeps it to a single render pass.
  const [activeKey, setActiveKey] = useState(resetKey)
  if (activeKey !== resetKey) {
    setActiveKey(resetKey)
    setState(IDENTITY)
    setAnimated(false)
  }

  // Mirror the committed transform for the gesture handlers, which read refs so
  // they never have to rebind (the render-phase reset above bypasses `apply`).
  useEffect(() => {
    stateRef.current = state
    zoomedRef.current = state.scale > MIN_SCALE
  }, [state])

  useEffect(() => {
    const container = containerRef?.current
    if (!enabled || !container) return undefined

    const owns = (node) => Boolean(node && targetRef.current?.contains(node))

    /* Zoom and pan are accepted anywhere over the viewport, not just on the media
       itself: the nav arrows sit at exactly the height where a pinching thumb lands,
       so requiring the gesture to start on the image would silently drop it. Taps on
       the controls survive because only multi-touch and moved drags preventDefault. */
    const canGesture = () => Boolean(targetRef.current)

    // Keep the media inside the viewport: pan is bounded by however much of the
    // scaled media sticks out, and re-centres on any axis that still fits.
    const clampPan = (next) => {
      const el = targetRef.current
      if (!el) return next
      const spareX = Math.max(0, (el.offsetWidth * next.scale - container.clientWidth) / 2)
      const spareY = Math.max(0, (el.offsetHeight * next.scale - container.clientHeight) / 2)
      return {
        scale: next.scale,
        x: clamp(next.x, -spareX, spareX),
        y: clamp(next.y, -spareY, spareY),
      }
    }

    /* Scale around a viewport point so the pixel under the cursor (or pinch
       midpoint) stays put. With a centred transform-origin the translation that
       holds point `d` (offset from the box centre) still is t' = t + d * (1 - k). */
    const zoomTo = (scale, point, animate = false) => {
      const el = targetRef.current
      if (!el) return
      const base = stateRef.current
      const next = clamp(scale, MIN_SCALE, MAX_SCALE)
      const rect = el.getBoundingClientRect()
      const k = next / base.scale
      const dx = point.x - (rect.left + rect.width / 2)
      const dy = point.y - (rect.top + rect.height / 2)
      apply(clampPan({ scale: next, x: base.x + dx * (1 - k), y: base.y + dy * (1 - k) }), animate)
    }

    const toggleAt = (point) => {
      if (zoomedRef.current) reset(true)
      else zoomTo(TAP_SCALE, point, true)
    }

    // A drag that ends over the backdrop would otherwise read as a click there
    // and close the viewer, so swallow the click that follows a real pan.
    const suppressNextClick = () => {
      const swallow = (e) => {
        e.stopPropagation()
        e.preventDefault()
      }
      container.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => container.removeEventListener('click', swallow, true), 400)
    }

    const onWheel = (e) => {
      if (!canGesture()) return
      e.preventDefault()
      // deltaMode 1 reports lines, not pixels (Firefox with a wheel mouse)
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : 1)
      zoomTo(stateRef.current.scale * Math.exp(-delta * 0.002), { x: e.clientX, y: e.clientY })
    }

    const onDoubleClick = (e) => {
      if (!owns(e.target)) return
      e.preventDefault()
      toggleAt({ x: e.clientX, y: e.clientY })
    }

    // --- Pointer (mouse / pen) panning ---
    let mousePan = null

    const onPointerMove = (e) => {
      if (!mousePan) return
      const dx = e.clientX - mousePan.origin.x
      const dy = e.clientY - mousePan.origin.y
      if (Math.abs(dx) > DRAG_SLOP || Math.abs(dy) > DRAG_SLOP) mousePan.moved = true
      apply(clampPan({ scale: mousePan.base.scale, x: mousePan.base.x + dx, y: mousePan.base.y + dy }))
    }

    const onPointerUp = () => {
      if (!mousePan) return
      if (mousePan.moved) suppressNextClick()
      mousePan = null
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }

    const onPointerDown = (e) => {
      if (e.pointerType === 'touch' || e.button !== 0 || !zoomedRef.current || !canGesture()) return
      e.preventDefault() // beats the browser's native image drag
      mousePan = { origin: { x: e.clientX, y: e.clientY }, base: stateRef.current, moved: false }
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
    }

    // --- Touch: pinch, pan, double tap ---
    let pinch = null
    let touchPan = null
    let pinched = false
    let lastTap = null

    const onTouchStart = (e) => {
      if (!canGesture()) return
      if (e.touches.length === 2) {
        const rect = targetRef.current.getBoundingClientRect()
        const center = midpointOf(e.touches[0], e.touches[1])
        pinch = {
          base: stateRef.current,
          center,
          offset: { x: center.x - (rect.left + rect.width / 2), y: center.y - (rect.top + rect.height / 2) },
          distance: distanceBetween(e.touches[0], e.touches[1]) || 1,
        }
        touchPan = null
        pinched = true
        lastTap = null
        if (e.cancelable) e.preventDefault() // claim the gesture before the scroller does
      } else if (e.touches.length === 1 && zoomedRef.current) {
        touchPan = {
          origin: { x: e.touches[0].clientX, y: e.touches[0].clientY },
          base: stateRef.current,
          moved: false,
        }
      }
    }

    const onTouchMove = (e) => {
      if (pinch && e.touches.length === 2) {
        if (e.cancelable) e.preventDefault()
        const center = midpointOf(e.touches[0], e.touches[1])
        const ratio = distanceBetween(e.touches[0], e.touches[1]) / pinch.distance
        const scale = clamp(pinch.base.scale * ratio, MIN_SCALE, MAX_SCALE)
        const k = scale / pinch.base.scale
        // Anchor on the pinch origin, then follow the midpoint as the hand moves
        apply(
          clampPan({
            scale,
            x: pinch.base.x + pinch.offset.x * (1 - k) + (center.x - pinch.center.x),
            y: pinch.base.y + pinch.offset.y * (1 - k) + (center.y - pinch.center.y),
          })
        )
      } else if (touchPan && e.touches.length === 1) {
        if (e.cancelable) e.preventDefault()
        const dx = e.touches[0].clientX - touchPan.origin.x
        const dy = e.touches[0].clientY - touchPan.origin.y
        if (Math.abs(dx) > DRAG_SLOP || Math.abs(dy) > DRAG_SLOP) touchPan.moved = true
        apply(clampPan({ scale: touchPan.base.scale, x: touchPan.base.x + dx, y: touchPan.base.y + dy }))
      }
    }

    const onTouchEnd = (e) => {
      if (e.touches.length < 2) pinch = null
      if (e.touches.length > 0) return

      const panned = Boolean(touchPan?.moved)
      touchPan = null
      if (zoomedRef.current && stateRef.current.scale <= SPRING_BACK_SCALE) reset(true)

      if (pinched || panned || e.changedTouches.length !== 1 || !owns(e.target)) {
        pinched = false
        lastTap = null
        return
      }

      const touch = e.changedTouches[0]
      const now = performance.now()
      const isDoubleTap =
        lastTap &&
        now - lastTap.time < DOUBLE_TAP_MS &&
        Math.hypot(touch.clientX - lastTap.x, touch.clientY - lastTap.y) < DOUBLE_TAP_SLOP

      if (isDoubleTap) {
        if (e.cancelable) e.preventDefault() // swallow the emulated click/dblclick pair
        lastTap = null
        toggleAt({ x: touch.clientX, y: touch.clientY })
      } else {
        lastTap = { time: now, x: touch.clientX, y: touch.clientY }
      }
    }

    container.addEventListener('wheel', onWheel, { passive: false })
    container.addEventListener('dblclick', onDoubleClick)
    container.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('touchstart', onTouchStart, { passive: false })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    container.addEventListener('touchend', onTouchEnd, { passive: false })
    container.addEventListener('touchcancel', onTouchEnd, { passive: false })

    return () => {
      container.removeEventListener('wheel', onWheel)
      container.removeEventListener('dblclick', onDoubleClick)
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
      container.removeEventListener('touchcancel', onTouchEnd)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [apply, containerRef, enabled, reset])

  return {
    targetRef,
    zoomedRef,
    isZoomed: state.scale > MIN_SCALE,
    reset,
    style: {
      transform: `translate3d(${state.x}px, ${state.y}px, 0) scale(${state.scale})`,
      transition: animated ? 'transform 0.25s ease' : 'none',
    },
  }
}

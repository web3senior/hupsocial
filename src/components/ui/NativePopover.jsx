'use client'

import React, { cloneElement, isValidElement, useEffect, useId, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import clsx from 'clsx'
import styles from './NativePopover.module.scss'

const GAP = 6
const MARGIN = 8

// A trigger inside fixed/sticky UI (sidebar, tab bar) doesn't move when the page
// scrolls, so its panel must stay viewport-fixed. In-flow triggers scroll with the
// content, so their panels are absolutely positioned in page coordinates instead —
// the compositor then moves panel and trigger together, with no per-frame JS chasing
// the scroll (which lags a frame behind and shakes).
function isViewportAnchored(el) {
  let node = el
  while (node && node !== document.body) {
    const position = getComputedStyle(node).position
    if (position === 'fixed' || position === 'sticky') return true
    node = node.parentElement
  }
  return false
}

// Opposite side per anchored placement, used when the preferred side doesn't fit
const FLIP = {
  'bottom-start': 'top-start',
  'bottom-end': 'top-end',
  'top-start': 'bottom-start',
  'top-end': 'bottom-end',
  'right-start': 'left-start',
  'right-end': 'left-end',
  'left-start': 'right-start',
  'left-end': 'right-end',
  // Side-centered placements: a panel narrower than its trigger (a tooltip over a
  // wide control, say) reads as mis-hung when edge-aligned, so it centers instead
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
}

function computePosition(triggerRect, pw, ph, placement) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const { left: tx, top: ty, width: tw, height: th } = triggerRect

  switch (placement) {
    case 'center':
      return { top: '50%', left: '50%', transform: '', placement }
    case 'bottom-right-corner':
      return { top: 'auto', left: 'auto', bottom: MARGIN + 'px', right: MARGIN + 'px', placement }
    case 'bottom-left-corner':
      return { top: 'auto', right: 'auto', bottom: MARGIN + 'px', left: MARGIN + 'px', placement }
    case 'top-right-corner':
      return { bottom: 'auto', left: 'auto', top: MARGIN + 'px', right: MARGIN + 'px', placement }
    case 'top-left-corner':
      return { bottom: 'auto', right: 'auto', top: MARGIN + 'px', left: MARGIN + 'px', placement }
    default: break
  }

  const coordsFor = (side) => {
    switch (side) {
      case 'bottom-end':   return { top: ty + th + GAP, left: tx + tw - pw }
      case 'top-start':    return { top: ty - ph - GAP, left: tx }
      case 'top-end':      return { top: ty - ph - GAP, left: tx + tw - pw }
      case 'right-start':  return { top: ty,            left: tx + tw + GAP }
      case 'right-end':    return { top: ty + th - ph,  left: tx + tw + GAP }
      case 'left-start':   return { top: ty,            left: tx - pw - GAP }
      case 'left-end':     return { top: ty + th - ph,  left: tx - pw - GAP }
      case 'top':          return { top: ty - ph - GAP,      left: tx + tw / 2 - pw / 2 }
      case 'bottom':       return { top: ty + th + GAP,      left: tx + tw / 2 - pw / 2 }
      case 'left':         return { top: ty + th / 2 - ph / 2, left: tx - pw - GAP }
      case 'right':        return { top: ty + th / 2 - ph / 2, left: tx + tw + GAP }
      case 'bottom-start':
      default:             return { top: ty + th + GAP, left: tx }
    }
  }

  // Flip to the opposite side when the preferred side overflows the viewport on its
  // primary axis and the opposite side fully fits (macOS-menu behavior); the clamp
  // below stays as the fallback when neither side fits
  let resolved = placement
  let { top, left } = coordsFor(placement)
  const isVertical = placement.startsWith('top') || placement.startsWith('bottom')
  const overflowsPrimary = isVertical
    ? top < MARGIN || top + ph > vh - MARGIN
    : left < MARGIN || left + pw > vw - MARGIN
  if (overflowsPrimary) {
    const flipped = FLIP[placement]
    const alt = coordsFor(flipped)
    const altFits = isVertical
      ? alt.top >= MARGIN && alt.top + ph <= vh - MARGIN
      : alt.left >= MARGIN && alt.left + pw <= vw - MARGIN
    if (altFits) {
      resolved = flipped
      top = alt.top
      left = alt.left
    }
  }

  // Clamp to viewport
  left = Math.max(MARGIN, Math.min(left, vw - pw - MARGIN))
  top  = Math.max(MARGIN, Math.min(top,  vh - ph - MARGIN))

  return { top: top + 'px', left: left + 'px', bottom: 'auto', right: 'auto', transform: '', placement: resolved }
}

/**
 * Measure an already-laid-out panel against its trigger and write its coords —
 * page coordinates (absolute) for in-flow triggers, viewport coordinates (fixed)
 * for triggers living in fixed/sticky UI and for trigger-independent placements.
 * Exported so other top-layer primitives (Tooltip) anchor by the same rules
 * instead of carrying a second copy of this math.
 */
export function anchorElement(panelEl, triggerEl, placement) {
  if (!panelEl || !triggerEl) return
  // Measure from a clean slate. With auto insets (first open) or the previous open's
  // stale coords (reopens), a shrink-to-fit panel sizes against whatever space that
  // position happens to leave — inside a dialog that can be a fraction of its
  // max-width — and the box measured below then rewraps once the real coords land,
  // leaving the panel anchored to a phantom size that drifts further every reopen.
  // Both callers keep the panel visibility:hidden through this, so the hop to the
  // origin never paints.
  panelEl.style.position = 'fixed'
  panelEl.style.top = '0px'
  panelEl.style.left = '0px'
  panelEl.style.bottom = 'auto'
  panelEl.style.right = 'auto'
  const rect = triggerEl.getBoundingClientRect()
  const anchored = placement !== 'center' && !placement.endsWith('-corner')
  const { placement: resolvedPlacement, ...pos } = computePosition(rect, panelEl.offsetWidth, panelEl.offsetHeight, placement)
  // Publish the side actually used — centering and the backdrop are styled off it
  panelEl.dataset.placement = resolvedPlacement
  if (anchored && !isViewportAnchored(triggerEl)) {
    panelEl.style.position = 'absolute'
    pos.top = `${parseFloat(pos.top) + window.scrollY}px`
    pos.left = `${parseFloat(pos.left) + window.scrollX}px`
  } else {
    panelEl.style.position = 'fixed'
  }
  Object.assign(panelEl.style, pos)
}

const NativePopover = forwardRef(function NativePopover({
  trigger,
  children,
  type = 'auto',
  action = 'toggle',
  placement = 'bottom-start',
  onBeforeToggle,
  onToggle,
  className,
}, ref) {
  const rawId = useId()
  const popoverId = `popover-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const popoverRef = useRef(null)
  const triggerRef = useRef(null)

  const reposition = useCallback(() => {
    anchorElement(popoverRef.current, triggerRef.current, placement)
  }, [placement])

  const applyPosition = useCallback(() => {
    const popoverEl = popoverRef.current
    if (!triggerRef.current || !popoverEl) return

    // At `beforetoggle` time the browser hasn't opened the popover yet
    // (display is still none), so offsetWidth/offsetHeight aren't
    // available until the next frame. Calling showPopover() ourselves
    // here would throw, since the browser's own show operation for
    // this popover is already in progress. Hide it, then measure and
    // position once it's actually laid out.
    popoverEl.style.visibility = 'hidden'

    requestAnimationFrame(() => {
      reposition()
      popoverEl.style.visibility = ''
    })
  }, [reposition])

  useEffect(() => {
    const node = popoverRef.current
    if (!node) return

    const handleBeforeToggle = (e) => {
      if (e.newState === 'open') applyPosition()
      onBeforeToggle?.(e)
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        try { node.hidePopover() } catch { /* not open */ }
      }
    }

    // Scroll never re-anchors an open panel: absolute panels ride the page natively,
    // and re-running the viewport-clamped math mid-scroll makes a clamped panel creep
    // back toward its unclamped spot. Scrolling only closes the panel once its trigger
    // leaves the viewport (standard menu behavior); resizing re-anchors it.
    // Center/corner placements don't depend on the trigger, so they need neither.
    const isAnchored = placement !== 'center' && !placement.endsWith('-corner')
    let frameId = null
    const schedule = (task) => {
      if (frameId) return
      frameId = requestAnimationFrame(() => {
        frameId = null
        if (node.matches(':popover-open')) task()
      })
    }
    const handleScroll = () =>
      schedule(() => {
        const rect = triggerRef.current?.getBoundingClientRect()
        if (!rect) return
        const outOfView = rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth
        if (outOfView) node.hidePopover()
      })
    const handleResize = () => schedule(reposition)

    node.addEventListener('beforetoggle', handleBeforeToggle)
    if (onToggle) node.addEventListener('toggle', onToggle)
    window.addEventListener('keydown', handleKeyDown, true)
    if (isAnchored) {
      // Capture phase so scrolls inside nested scroll containers count too
      window.addEventListener('scroll', handleScroll, true)
      window.addEventListener('resize', handleResize)
    }

    return () => {
      node.removeEventListener('beforetoggle', handleBeforeToggle)
      if (onToggle) node.removeEventListener('toggle', onToggle)
      window.removeEventListener('keydown', handleKeyDown, true)
      if (isAnchored) {
        window.removeEventListener('scroll', handleScroll, true)
        window.removeEventListener('resize', handleResize)
      }
      if (frameId) cancelAnimationFrame(frameId)
    }
  }, [applyPosition, placement, reposition, onBeforeToggle, onToggle])

  const close = () => {
    popoverRef.current?.hidePopover()
  }

  const open = () => {
    const el = popoverRef.current
    if (!el || el.matches(':popover-open')) return
    el.showPopover()
  }

  useImperativeHandle(ref, () => ({ open, close }), [open, close])

  const triggerProps = {
    popoverTarget: popoverId,
    popoverTargetAction: action,
    'aria-controls': popoverId,
  }

  const triggerNode = isValidElement(trigger) ? (
    cloneElement(trigger, {
      ...triggerProps,
      ref: triggerRef,
      type: trigger.props.type ?? 'button',
      style: trigger.props.style,
    })
  ) : (
    <button type="button" {...triggerProps} ref={triggerRef} className={styles.trigger}>
      {trigger}
    </button>
  )

  return (
    <>
      {triggerNode}
      <div
        id={popoverId}
        ref={popoverRef}
        popover={type}
        data-placement={placement}
        className={clsx(styles.panel, className)}
      >
        {typeof children === 'function' ? children({ close, open }) : children}
      </div>
    </>
  )
})

export default NativePopover

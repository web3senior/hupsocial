'use client'

import React, { cloneElement, isValidElement, useEffect, useId, useRef, useCallback } from 'react'
import clsx from 'clsx'
import styles from './NativePopover.module.scss'

const GAP = 6
const MARGIN = 8

function computePosition(triggerRect, pw, ph, placement) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const { left: tx, top: ty, width: tw, height: th } = triggerRect

  switch (placement) {
    case 'center':
      return { top: '50%', left: '50%', transform: '' }
    case 'bottom-right-corner':
      return { top: 'auto', left: 'auto', bottom: MARGIN + 'px', right: MARGIN + 'px' }
    case 'bottom-left-corner':
      return { top: 'auto', right: 'auto', bottom: MARGIN + 'px', left: MARGIN + 'px' }
    case 'top-right-corner':
      return { bottom: 'auto', left: 'auto', top: MARGIN + 'px', right: MARGIN + 'px' }
    case 'top-left-corner':
      return { bottom: 'auto', right: 'auto', top: MARGIN + 'px', left: MARGIN + 'px' }
    default: break
  }

  let top, left

  switch (placement) {
    case 'bottom-end':   top = ty + th + GAP; left = tx + tw - pw; break
    case 'top-start':    top = ty - ph - GAP; left = tx;            break
    case 'top-end':      top = ty - ph - GAP; left = tx + tw - pw;  break
    case 'right-start':  top = ty;            left = tx + tw + GAP; break
    case 'right-end':    top = ty + th - ph;  left = tx + tw + GAP; break
    case 'left-start':   top = ty;            left = tx - pw - GAP; break
    case 'left-end':     top = ty + th - ph;  left = tx - pw - GAP; break
    case 'bottom-start':
    default:             top = ty + th + GAP; left = tx;            break
  }

  // Clamp to viewport
  left = Math.max(MARGIN, Math.min(left, vw - pw - MARGIN))
  top  = Math.max(MARGIN, Math.min(top,  vh - ph - MARGIN))

  return { top: top + 'px', left: left + 'px', bottom: 'auto', right: 'auto', transform: '' }
}

export default function NativePopover({
  trigger,
  children,
  type = 'auto',
  action = 'toggle',
  placement = 'bottom-start',
  onBeforeToggle,
  onToggle,
  className,
}) {
  const rawId = useId()
  const popoverId = `popover-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const popoverRef = useRef(null)
  const triggerRef = useRef(null)
  const measuringRef = useRef(false)

  const applyPosition = useCallback(() => {
    if (measuringRef.current) return
    const triggerEl = triggerRef.current
    const popoverEl = popoverRef.current
    if (!triggerEl || !popoverEl) return

    // offsetWidth/offsetHeight are 0 while the popover is hidden.
    // Move it off-screen, make it visible just long enough to measure, then position.
    const wasHidden = !popoverEl.matches(':popover-open')
    if (wasHidden) {
      measuringRef.current = true
      Object.assign(popoverEl.style, { position: 'fixed', top: '-9999px', left: '-9999px', visibility: 'hidden' })
      popoverEl.showPopover()
    }

    const rect = triggerEl.getBoundingClientRect()
    const pw = popoverEl.offsetWidth
    const ph = popoverEl.offsetHeight

    if (wasHidden) {
      popoverEl.hidePopover()
      popoverEl.style.visibility = ''
      measuringRef.current = false
    }

    const pos = computePosition(rect, pw, ph, placement)
    Object.assign(popoverEl.style, pos)
  }, [placement])

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

    node.addEventListener('beforetoggle', handleBeforeToggle)
    if (onToggle) node.addEventListener('toggle', onToggle)
    window.addEventListener('keydown', handleKeyDown, true)

    return () => {
      node.removeEventListener('beforetoggle', handleBeforeToggle)
      if (onToggle) node.removeEventListener('toggle', onToggle)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [applyPosition, onBeforeToggle, onToggle])

  const close = () => {
    popoverRef.current?.hidePopover()
  }

  const open = () => {
    const el = popoverRef.current
    if (!el || el.matches(':popover-open')) return
    applyPosition()
    el.showPopover()
  }

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
}

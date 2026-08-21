'use client'

import { cloneElement, forwardRef, isValidElement, useCallback, useEffect, useId, useRef } from 'react'
import clsx from 'clsx'
import { anchorElement } from './NativePopover'
import styles from './Tooltip.module.scss'

const OPEN_DELAY = 400
const CLOSE_DELAY = 60
// Touch has no hover, so a press reveals the bubble instead — on its own timer, so it
// never lingers over whatever that same press opened (a native select picker, a panel)
const TOUCH_DURATION = 2600

/**
 * Tooltip
 * A hover/focus description bubble anchored to its child. It shares NativePopover's
 * anchoring (flip when a side doesn't fit, clamp to the viewport, page coordinates for
 * in-flow triggers) but drives the top layer itself with `popover="manual"`: an auto
 * popover would light-dismiss, and a tooltip that swallows the click meant to close a
 * menu behind it is worse than no tooltip.
 *
 * The child IS the trigger — it gets cloned with a ref and pointer handlers rather than
 * wrapped in a box, so adding a tooltip never reflows the row the control sits in. Any
 * ref already on that child is replaced by the tooltip's own.
 *
 * Leftover props and an incoming ref pass straight through to that child, which is what
 * lets a Tooltip sit between a primitive and its trigger — `trigger={<Tooltip …><button/>
 * </Tooltip>}` still hands NativePopover the real button. With no `content` (or with
 * `disabled`), it collapses to that pass-through and renders nothing of its own.
 *
 * `size="compact"` swaps the descriptive bubble for the sidebar's name pill — the shape for
 * one or two words naming an icon-only control. `hoverOnly` drops the touch-press reveal, for
 * controls whose tap already does something visible.
 *
 * The bubble is inert (`pointer-events: none`) — it describes, it never holds controls.
 * For content the user must click, reach for NativePopover instead.
 */
const Tooltip = forwardRef(function Tooltip(
  { children, content, placement = 'top', delay = OPEN_DELAY, size = 'default', hoverOnly = false, className, disabled = false, ...rest },
  ref
) {
  const rawId = useId()
  const tooltipId = `tooltip-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const panelRef = useRef(null)
  const triggerRef = useRef(null)
  const openTimerRef = useRef(null)
  const closeTimerRef = useRef(null)
  const detachRef = useRef(null)
  const pointerFocusRef = useRef(false)

  const clearTimers = useCallback(() => {
    clearTimeout(openTimerRef.current)
    clearTimeout(closeTimerRef.current)
    openTimerRef.current = null
    closeTimerRef.current = null
  }, [])

  const close = useCallback(() => {
    clearTimers()
    detachRef.current?.()
    detachRef.current = null
    const el = panelRef.current
    if (el?.matches(':popover-open')) el.hidePopover()
  }, [clearTimers])

  const open = useCallback(() => {
    clearTimers()
    const el = panelRef.current
    if (!el || el.matches(':popover-open')) return

    // Nothing to measure until showPopover() lands — a closed popover is display:none
    // and reports a zero box — so it opens invisible and is placed on the next frame
    el.style.visibility = 'hidden'
    el.showPopover()
    requestAnimationFrame(() => {
      if (!el.matches(':popover-open')) return
      anchorElement(el, triggerRef.current, placement)
      el.style.visibility = ''
    })

    // A tooltip is transient, so movement dismisses it rather than chasing the trigger.
    // Bound to the open state so a page of tooltips isn't a page of idle scroll listeners.
    const dismiss = () => close()
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('keydown', handleKeyDown, true)
    detachRef.current = () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [clearTimers, close, placement])

  const scheduleOpen = useCallback(() => {
    clearTimers()
    openTimerRef.current = setTimeout(open, delay)
  }, [clearTimers, delay, open])

  const scheduleClose = useCallback(() => {
    clearTimers()
    closeTimerRef.current = setTimeout(close, CLOSE_DELAY)
  }, [clearTimers, close])

  // Whoever wrapped this tooltip gets a ref to the real trigger, not to the Tooltip
  // element they wrote — NativePopover measures that node to place its own panel.
  // No dep array: the child can swap the node out from under us on any render.
  useEffect(() => {
    if (!ref) return undefined
    const node = triggerRef.current
    if (typeof ref === 'function') {
      ref(node)
      return () => ref(null)
    }
    ref.current = node
    return () => {
      ref.current = null
    }
  })

  useEffect(
    () => () => {
      clearTimers()
      detachRef.current?.()
      detachRef.current = null
    },
    [clearTimers]
  )

  // Losing its content mid-hover unmounts the panel out from under an open tooltip,
  // which would strand its dismiss listeners
  useEffect(() => {
    if (!content || disabled) close()
  }, [content, disabled, close])

  if (!content || disabled) {
    if (!isValidElement(children)) return children
    return cloneElement(children, { ...rest, ref: triggerRef })
  }

  const childProps = isValidElement(children) ? children.props : {}

  // These five may already be coming from the child or from whatever wrapped this
  // tooltip, and both spreads sit under ours — so run theirs first
  const handlers = {
    onPointerEnter: (e) => {
      rest.onPointerEnter?.(e)
      childProps.onPointerEnter?.(e)
      if (e.pointerType !== 'touch') scheduleOpen()
    },
    onPointerLeave: (e) => {
      rest.onPointerLeave?.(e)
      childProps.onPointerLeave?.(e)
      scheduleClose()
    },
    onPointerDown: (e) => {
      rest.onPointerDown?.(e)
      childProps.onPointerDown?.(e)
      if (e.pointerType === 'touch') {
        // A hoverOnly control acts on the tap itself — a bubble covering the row the user
        // just pressed says nothing the press has not already said
        if (hoverOnly) return
        open()
        closeTimerRef.current = setTimeout(close, TOUCH_DURATION)
        return
      }
      // A click means the user is acting on the control, not reading about it. The
      // flag lives just long enough to reach the focus this same press causes —
      // mouse focus lands synchronously inside the press, before a 0ms timeout.
      pointerFocusRef.current = true
      setTimeout(() => {
        pointerFocusRef.current = false
      }, 0)
      close()
    },
    onFocus: (e) => {
      rest.onFocus?.(e)
      childProps.onFocus?.(e)
      // Keyboard arrivals only — :focus-visible alone can't tell: Chromium grants it
      // to form controls (selects included) even when the focus came from a click
      if (!pointerFocusRef.current && e.target.matches(':focus-visible')) open()
    },
    onBlur: (e) => {
      rest.onBlur?.(e)
      childProps.onBlur?.(e)
      close()
    },
  }

  const describedBy = [childProps['aria-describedby'], tooltipId].filter(Boolean).join(' ')

  const triggerNode = isValidElement(children) ? (
    cloneElement(children, { ...rest, ...handlers, ref: triggerRef, 'aria-describedby': describedBy })
  ) : (
    <span ref={triggerRef} className={styles.anchor} aria-describedby={describedBy} {...rest} {...handlers}>
      {children}
    </span>
  )

  return (
    <>
      {triggerNode}
      <div
        id={tooltipId}
        ref={panelRef}
        popover="manual"
        role="tooltip"
        data-placement={placement}
        data-size={size}
        className={clsx(styles.tooltip, className)}
      >
        {content}
      </div>
    </>
  )
})

export default Tooltip

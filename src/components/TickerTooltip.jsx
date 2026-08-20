'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cashtagFor } from '@/config/cashtags'
import { anchorElement } from './ui/NativePopover'
import Ticker from './Ticker'
import styles from './TickerTooltip.module.scss'

/**
 * The cashtag card, in the native top layer.
 *
 * Hover is not an input mode on a phone, and this app is read on phones — so a fine pointer
 * gets the old hover behavior and a coarse one taps to open. The panel is a real `popover`
 * rather than a floating div: that buys light-dismiss, Escape, and top-layer stacking from
 * the platform, and it anchors through NativePopover's own `anchorElement` so cards hang by
 * the same rules as every other anchored panel in the app.
 */
export default function TickerTooltip() {
  const [active, setActive] = useState(null)
  const panelRef = useRef(null)
  const triggerRef = useRef(null)
  // A tap on an open card's own cashtag should close it. The browser light-dismisses on
  // pointerdown, well before the click below lands, so without remembering what just closed
  // the handler would simply reopen the card and the tap would read as a no-op.
  const lastClosed = useRef({ symbol: null, at: 0 })

  const hide = useCallback(() => {
    try {
      panelRef.current?.hidePopover()
    } catch {
      /* already closed */
    }
  }, [])

  const show = useCallback((target, symbol) => {
    // config/cashtags is the only registry — the same one the cards under a post resolve
    // against, so a symbol either has a card everywhere or nowhere. An unknown cashtag shows
    // nothing: the map this replaced defaulted several to addresses that were not the token.
    if (!cashtagFor(symbol)) return

    triggerRef.current = target
    setActive({ symbol })
  }, [])

  useEffect(() => {
    const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches

    const handleMouseOver = (e) => {
      const target = e.target.closest('.ticker-trigger')
      if (target) show(target, target.getAttribute('data-symbol'))
    }

    const handleMouseOut = (e) => {
      if (e.target.closest('.ticker-trigger')) hide()
    }

    // Capture phase: post and comment cards navigate to the thread on click, and their
    // handlers run on React's root container. Stopping here keeps a tap on a cashtag from
    // also opening the post.
    const handleClick = (e) => {
      const target = e.target.closest('.ticker-trigger')
      if (!target) return
      e.preventDefault()
      e.stopPropagation()

      const symbol = target.getAttribute('data-symbol')
      const justClosed = lastClosed.current.symbol === symbol && Date.now() - lastClosed.current.at < 400
      if (justClosed) {
        lastClosed.current = { symbol: null, at: 0 }
        return
      }
      show(target, symbol)
    }

    // Hover exists only on fine pointers, but the click guard is unconditional. A cashtag is
    // an interactive element: clicking one must never open the post underneath, on any device.
    // Binding this for coarse pointers alone left every hybrid in between — touch laptops,
    // device emulation, Android browsers that report (hover: hover) — falling straight through
    // to the card's own navigation.
    if (canHover) {
      document.addEventListener('mouseover', handleMouseOver)
      document.addEventListener('mouseout', handleMouseOut)
    }
    document.addEventListener('click', handleClick, true)

    return () => {
      document.removeEventListener('mouseover', handleMouseOver)
      document.removeEventListener('mouseout', handleMouseOut)
      document.removeEventListener('click', handleClick, true)
    }
  }, [hide, show])

  // Open and anchor once the card's content is in the DOM. The quote arrives over SWR, so the
  // panel grows from "Loading..." to a full card after it is already placed — a ResizeObserver
  // re-anchors it rather than leaving it hanging off its first, much smaller, measurement.
  useEffect(() => {
    const panel = panelRef.current
    if (!panel || !active) return

    const place = () => anchorElement(panel, triggerRef.current, 'top')

    if (!panel.matches(':popover-open')) {
      panel.style.visibility = 'hidden'
      panel.showPopover()
    }
    const frame = requestAnimationFrame(() => {
      place()
      panel.style.visibility = ''
    })

    const observer = new ResizeObserver(() => {
      if (panel.matches(':popover-open')) place()
    })
    observer.observe(panel)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [active])

  // Light-dismiss and Escape close the panel without going through hide(), so the React state
  // has to follow the element rather than the other way around
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    const handleToggle = (e) => {
      if (e.newState === 'closed') {
        lastClosed.current = { symbol: active?.symbol ?? null, at: Date.now() }
        setActive(null)
      }
    }

    panel.addEventListener('toggle', handleToggle)
    return () => panel.removeEventListener('toggle', handleToggle)
  }, [active])

  return (
    <div ref={panelRef} popover="auto" className={styles.floatingContainer}>
      {active && <Ticker symbol={active.symbol} />}
    </div>
  )
}

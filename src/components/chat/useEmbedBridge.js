'use client'

import { useEffect } from 'react'

// Must match public/chat-widget.js
export const EMBED_STATE_MESSAGE = 'hup:chat:state'

/**
 * The framed dock's side of public/chat-widget.js. The host page owns the frame's size, so the
 * dock reports its mode, and while minimized the pill's own size, for the loader to fit the
 * frame to. Links leave the frame for a new tab: the app itself refuses to be framed by the host.
 * @param {{enabled: boolean, dockRef: React.RefObject<HTMLElement>, mode: string}} options
 */
export function useEmbedBridge({ enabled, dockRef, mode }) {
  useEffect(() => {
    if (!enabled || window.parent === window) return undefined
    const dock = dockRef.current
    // Size and mode only, nothing private, so the host's origin need not be known
    const report = () => {
      const rect = dock?.getBoundingClientRect()
      window.parent.postMessage(
        { type: EMBED_STATE_MESSAGE, mode, width: Math.ceil(rect?.width ?? 0), height: Math.ceil(rect?.height ?? 0) },
        '*'
      )
    }
    report()
    if (!dock || mode !== 'minimized') return undefined
    const observer = new ResizeObserver(report)
    observer.observe(dock)
    return () => observer.disconnect()
  }, [enabled, dockRef, mode])

  useEffect(() => {
    if (!enabled) return undefined
    // Capture on window runs before React's root listener, so next/link never navigates the frame
    const onClick = (event) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!anchor || event.defaultPrevented) return
      const url = new URL(anchor.getAttribute('href'), window.location.href)
      if (!/^https?:$/.test(url.protocol)) return
      event.preventDefault()
      event.stopPropagation()
      window.open(url.href, '_blank', 'noopener,noreferrer')
    }
    window.addEventListener('click', onClick, true)
    return () => window.removeEventListener('click', onClick, true)
  }, [enabled])
}

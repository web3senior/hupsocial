'use client'

import { useEffect, useState } from 'react'

// Must match public/chat-widget.js
export const EMBED_STATE_MESSAGE = 'hup:chat:state'
const WIDGET_QUERY = 'hup:chat:widget?'
const WIDGET_INFO = 'hup:chat:widget'
const VERSION_SHAPE = /^[0-9]{1,3}([.][0-9]{1,3}){1,2}$/

/**
 * The framed dock's side of public/chat-widget.js. The host page owns the frame's size, so the
 * dock reports its mode, and while minimized the pill's own size, for the loader to fit the
 * frame to. Links leave the frame for a new tab: the app itself refuses to be framed by the host.
 * @param {{enabled: boolean, dockRef: React.RefObject<HTMLElement>, mode: string}} options
 * @returns {{widgetVersion: string|null}} null when the host page runs no widget script, or an old one
 */
export function useEmbedBridge({ enabled, dockRef, mode }) {
  const [widgetVersion, setWidgetVersion] = useState(null)

  useEffect(() => {
    if (!enabled || window.parent === window) return undefined
    // The host's word, shown as text: held to a version's shape so nothing else can be put there
    const onMessage = (event) => {
      if (event.source !== window.parent || event.data?.type !== WIDGET_INFO) return
      const version = String(event.data.version ?? '')
      if (VERSION_SHAPE.test(version)) setWidgetVersion(version)
    }
    window.addEventListener('message', onMessage)
    window.parent.postMessage({ type: WIDGET_QUERY }, '*')
    return () => window.removeEventListener('message', onMessage)
  }, [enabled])

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

  return { widgetVersion }
}

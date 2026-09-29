'use client'

import { useEffect, useRef, useState } from 'react'

// Must match public/chat-widget.js
export const EMBED_STATE_MESSAGE = 'hup:chat:state'
const WIDGET_QUERY = 'hup:chat:widget?'
const WIDGET_INFO = 'hup:chat:widget'
const DRAG_MESSAGE = 'hup:chat:drag'
const VERSION_SHAPE = /^[0-9]{1,3}([.][0-9]{1,3}){1,2}$/

// Travel under this is a tap, and is what the scale below is measured over
const DRAG_START_PX = 5
const SCALE_MIN = 0.25
const SCALE_MAX = 4

const HOST_WALLETS = new Set(['none', 'grid', 'page client', 'injected'])
const NAME_LIMIT = 40
const NAMES_LIMIT = 5

// The host's word, shown as text: held to the shapes expected so nothing else can be put there
const readHost = (host) => {
  if (!host || typeof host !== 'object') return null
  return {
    framed: host.framed === true,
    lukso: host.lukso === true,
    ethereum: host.ethereum === true,
    announced: Array.isArray(host.announced) ? host.announced.slice(0, NAMES_LIMIT).map((name) => String(name).slice(0, NAME_LIMIT)) : [],
    wallet: HOST_WALLETS.has(host.wallet) ? host.wallet : 'none',
  }
}

/**
 * What the page framing this one says of itself: which public/chat-widget.js it runs, and which
 * wallets it has. Asked again on `refresh`, since a wallet can arrive after the first answer.
 * @returns {{version: string|null, host: object|null, drag: boolean}} nulls when it runs no script, or one too old to say
 */
export function useWidgetInfo(enabled = true, refresh = 0) {
  const [info, setInfo] = useState({ version: null, host: null, drag: false })

  useEffect(() => {
    if (!enabled || window.parent === window) return undefined
    const onMessage = (event) => {
      if (event.source !== window.parent || event.data?.type !== WIDGET_INFO) return
      const version = String(event.data.version ?? '')
      if (VERSION_SHAPE.test(version)) setInfo({ version, host: readHost(event.data.host), drag: event.data.drag === true })
    }
    window.addEventListener('message', onMessage)
    window.parent.postMessage({ type: WIDGET_QUERY }, '*')
    return () => window.removeEventListener('message', onMessage)
  }, [enabled, refresh])

  return info
}

/** @returns {string|null} null when the page framing this one runs no widget script, or an old one */
export function useWidgetVersion(enabled = true) {
  return useWidgetInfo(enabled).version
}

const NO_DRAG = { isDragging: false, barProps: {}, pillProps: {}, consumeClick: () => false }

/**
 * Drag for the framed room. The frame is the host page's to move and the pointer is over this
 * one, so the gesture is read here and reported. Screen coordinates, because the frame moves
 * under the pointer and takes the client ones with it; their scale against CSS pixels is
 * measured over the first travel, before anything has moved.
 * @returns {{isDragging: boolean, barProps: object, pillProps: object, consumeClick: () => boolean}}
 */
function useEmbedDrag(enabled) {
  const dragRef = useRef(null)
  const draggedRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)

  if (!enabled) return NO_DRAG

  const report = (detail) => window.parent.postMessage({ type: DRAG_MESSAGE, ...detail }, '*')

  const start = (event, isBar) => {
    draggedRef.current = false
    // A press on a button in the bar is left to the button
    if (event.button !== 0 || (isBar && event.target.closest('button'))) return
    dragRef.current = { screenX: event.screenX, screenY: event.screenY, clientX: event.clientX, clientY: event.clientY, scale: null }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event) => {
    const drag = dragRef.current
    if (!drag) return
    const x = event.screenX - drag.screenX
    const y = event.screenY - drag.screenY

    if (drag.scale === null) {
      const travel = Math.hypot(x, y)
      if (travel < DRAG_START_PX) return
      const scale = Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) / travel
      drag.scale = scale >= SCALE_MIN && scale <= SCALE_MAX ? scale : 1
      setIsDragging(true)
    }

    report({ phase: 'move', x: x * drag.scale, y: y * drag.scale })
  }

  const endDrag = (event) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    if (drag.scale === null) return
    draggedRef.current = true
    setIsDragging(false)
    report({ phase: 'end' })
  }

  const handlers = { onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag }

  return {
    isDragging,
    barProps: { ...handlers, onPointerDown: (event) => start(event, true) },
    pillProps: { ...handlers, onPointerDown: (event) => start(event, false) },
    // The click that ends a drag of the pill is not a tap on it
    consumeClick: () => {
      const wasDragged = draggedRef.current
      draggedRef.current = false
      return wasDragged
    },
  }
}

/**
 * The framed dock's side of public/chat-widget.js. The host page owns the frame's size, so the
 * dock reports its mode, and while minimized the pill's own size, for the loader to fit the
 * frame to. Links leave the frame for a new tab: the app itself refuses to be framed by the host.
 * @param {{enabled: boolean, dockRef: React.RefObject<HTMLElement>, mode: string}} options
 * @returns {{widgetVersion: string|null, drag: object}}
 */
export function useEmbedBridge({ enabled, dockRef, mode }) {
  const widget = useWidgetInfo(enabled)
  const drag = useEmbedDrag(enabled && widget.drag)
  const widgetVersion = widget.version

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

  return { widgetVersion, drag }
}

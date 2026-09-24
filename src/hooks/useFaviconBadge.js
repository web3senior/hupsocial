'use client'

import { useEffect } from 'react'

// Drawn at 64px so it stays sharp in the 32px hidpi slot browsers actually paint
const ICON_SIZE = 64
// The SVG rasterises crisply at any size; the PNG is the fallback if it ever fails to decode
const BASE_ICON_SOURCES = ['/favicon.svg', '/favicon-96x96.png']
// Telegram-style unread dot; canvas can't read CSS tokens
const BADGE_COLOR = '#ef4444'
const BADGE_RING_COLOR = '#ffffff'
// Any rel a browser does not recognise parks the app's own icons while the badge is up
const IDLE_REL = 'hup-idle-icon'
const BADGE_LINK_ID = 'hup-favicon-badge'
// Background tabs clamp timers to 1s anyway, so a faster blink would just stutter
const BLINK_INTERVAL_MS = 1000

let baseIconPromise = null
let blinkFramesPromise = null

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })

// Decoded once per document, so every later redraw is pure canvas work
const loadBaseIcon = () => {
  if (!baseIconPromise) {
    baseIconPromise = BASE_ICON_SOURCES.reduce((chain, src) => chain.catch(() => loadImage(src)), Promise.reject()).catch(() => null)
  }

  return baseIconPromise
}

const drawIcon = (baseIcon, withDot) => {
  const canvas = document.createElement('canvas')
  canvas.width = ICON_SIZE
  canvas.height = ICON_SIZE

  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.drawImage(baseIcon, 0, 0, ICON_SIZE, ICON_SIZE)
  if (!withDot) return canvas.toDataURL('image/png')

  const ringWidth = ICON_SIZE * 0.07
  const radius = ICON_SIZE * 0.17
  const center = ICON_SIZE - radius - ringWidth / 2 - 1

  ctx.beginPath()
  ctx.arc(center, radius + ringWidth / 2 + 1, radius, 0, Math.PI * 2)
  ctx.lineWidth = ringWidth
  ctx.strokeStyle = BADGE_RING_COLOR
  ctx.stroke()
  ctx.fillStyle = BADGE_COLOR
  ctx.fill()

  return canvas.toDataURL('image/png')
}

// Both blink frames are drawn once per document; the plain one is a data URL too so swapping never refetches
const loadBlinkFrames = () => {
  if (!blinkFramesPromise) {
    blinkFramesPromise = loadBaseIcon().then((baseIcon) => {
      if (!baseIcon) return null

      const on = drawIcon(baseIcon, true)
      const off = drawIcon(baseIcon, false)
      return on && off ? { on, off } : null
    })
  }

  return blinkFramesPromise
}

const showBadge = (href) => {
  document.querySelectorAll(`link[rel~="icon"]:not(#${BADGE_LINK_ID})`).forEach((link) => {
    link.dataset.hupIconRel = link.getAttribute('rel')
    link.setAttribute('rel', IDLE_REL)
  })

  let link = document.getElementById(BADGE_LINK_ID)

  if (!link) {
    link = document.createElement('link')
    link.id = BADGE_LINK_ID
    link.rel = 'icon'
    link.type = 'image/png'
    // Appended last: browsers disagree on which declared icon wins, and the last one always does
    document.head.appendChild(link)
  }

  link.href = href
}

const clearBadge = () => {
  document.getElementById(BADGE_LINK_ID)?.remove()

  document.querySelectorAll(`link[rel="${IDLE_REL}"]`).forEach((link) => {
    link.setAttribute('rel', link.dataset.hupIconRel || 'icon')
    delete link.dataset.hupIconRel
  })
}

const syncAppBadge = (count) => {
  if (typeof navigator === 'undefined' || !('setAppBadge' in navigator)) return

  const request = count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge()
  // Rejects when the document is not an installed app — nothing to recover from
  request?.catch?.(() => {})
}

/**
 * Blink a dot on the browser-tab favicon while there is anything unread and the tab is in the background,
 * and put the count on the installed app's icon whenever the Badging API is there.
 * @param {number} count
 * @param {{onlyWhenHidden?: boolean}} [options] pass onlyWhenHidden: false to badge a focused tab too
 */
export const useFaviconBadge = (count, { onlyWhenHidden = true } = {}) => {
  const total = Number(count) || 0
  const hasUnread = total > 0

  // Split from the sync effect so a changing count never flickers the icon off and on
  useEffect(() => clearBadge, [])

  useEffect(() => {
    let cancelled = false
    let blinkTimer = null

    const stopBlink = () => {
      clearInterval(blinkTimer)
      blinkTimer = null
    }

    const shouldBadge = () => hasUnread && (!onlyWhenHidden || document.hidden)

    const sync = async () => {
      if (!shouldBadge()) {
        stopBlink()
        clearBadge()
        return
      }

      const frames = await loadBlinkFrames()
      // Visibility may have flipped back while the frames were decoding
      if (!frames || cancelled || blinkTimer || !shouldBadge()) return

      let dotShown = true
      showBadge(frames.on)
      blinkTimer = setInterval(() => {
        dotShown = !dotShown
        showBadge(dotShown ? frames.on : frames.off)
      }, BLINK_INTERVAL_MS)
    }

    sync()
    document.addEventListener('visibilitychange', sync)

    return () => {
      cancelled = true
      stopBlink()
      document.removeEventListener('visibilitychange', sync)
    }
  }, [hasUnread, onlyWhenHidden])

  useEffect(() => {
    syncAppBadge(total)
  }, [total])
}

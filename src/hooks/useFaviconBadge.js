'use client'

import { useEffect } from 'react'

// Drawn at 64px so it stays sharp in the 32px hidpi slot browsers actually paint
const ICON_SIZE = 64
// The SVG rasterises crisply at any size; the PNG is the fallback if it ever fails to decode
const BASE_ICON_SOURCES = ['/favicon.svg', '/favicon-96x96.png']
const BADGE_COLOR = '#ff007a'
const BADGE_RING_COLOR = '#ffffff'
const BADGE_TEXT_COLOR = '#ffffff'
const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", sans-serif'
// Any rel a browser does not recognise parks the app's own icons while the badge is up
const IDLE_REL = 'hup-idle-icon'
const BADGE_LINK_ID = 'hup-favicon-badge'

let baseIconPromise = null

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

const tracePill = (ctx, x, y, width, height) => {
  const radius = height / 2

  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
}

const drawBadgedIcon = (baseIcon, label) => {
  const canvas = document.createElement('canvas')
  canvas.width = ICON_SIZE
  canvas.height = ICON_SIZE

  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.drawImage(baseIcon, 0, 0, ICON_SIZE, ICON_SIZE)

  const height = ICON_SIZE * 0.5
  // A single digit sits in a circle, two characters need the pill stretched
  const width = height + (label.length > 1 ? height * 0.46 : 0)
  const x = ICON_SIZE - width - 1
  const y = 1

  tracePill(ctx, x, y, width, height)
  ctx.lineWidth = ICON_SIZE * 0.075
  ctx.strokeStyle = BADGE_RING_COLOR
  ctx.stroke()
  ctx.fillStyle = BADGE_COLOR
  ctx.fill()

  ctx.fillStyle = BADGE_TEXT_COLOR
  ctx.font = `700 ${Math.round(ICON_SIZE * 0.34)}px ${FONT_STACK}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x + width / 2, y + height / 2 + ICON_SIZE * 0.02)

  return canvas.toDataURL('image/png')
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
 * Stamp the unread count on the browser-tab favicon while the tab is in the background,
 * and on the installed app's icon whenever the Badging API is there.
 * @param {number} count
 * @param {{onlyWhenHidden?: boolean}} [options] pass onlyWhenHidden: false to badge a focused tab too
 */
export const useFaviconBadge = (count, { onlyWhenHidden = true } = {}) => {
  const total = Number(count) || 0

  // Split from the sync effect so a changing count never flickers the icon off and on
  useEffect(() => clearBadge, [])

  useEffect(() => {
    let cancelled = false

    const sync = async () => {
      if (total < 1 || (onlyWhenHidden && !document.hidden)) {
        clearBadge()
        return
      }

      const baseIcon = await loadBaseIcon()
      if (cancelled || !baseIcon) return

      const href = drawBadgedIcon(baseIcon, total > 9 ? '9+' : String(total))
      if (href && !cancelled) showBadge(href)
    }

    sync()
    document.addEventListener('visibilitychange', sync)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', sync)
    }
  }, [total, onlyWhenHidden])

  useEffect(() => {
    syncAppBadge(total)
  }, [total])
}

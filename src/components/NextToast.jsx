'use client'

import clsx from 'clsx'
import styles from './NextToast.module.scss'

const DEFAULT_DURATION = 5000
const DEFAULT_POSITION = `top-right`
const MAX_VISIBLE = 3
const POSITIONS = new Set([`top-left`, `top-right`, `bottom-left`, `bottom-right`])

// `error` is the type used across the app, `danger` is the actual style variant.
const TYPE_ALIASES = {
  error: 'danger',
}

const ICONS = {
  success: `<svg viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10Zm4.774-12.834a1 1 0 0 0-1.548-1.266l-4.3 5.257-2.219-2.22a1 1 0 0 0-1.414 1.415l3 3a1 1 0 0 0 1.481-.075l5-6.111Z"/></svg>`,
  danger: `<svg viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10ZM9.707 8.293a1 1 0 0 0-1.414 1.414L10.586 12l-2.293 2.293a1 1 0 1 0 1.414 1.414L12 13.414l2.293 2.293a1 1 0 0 0 1.414-1.414L13.414 12l2.293-2.293a1 1 0 0 0-1.414-1.414L12 10.586 9.707 8.293Z"/></svg>`,
  warning: `<svg viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M10.257 3.099c.765-1.36 2.722-1.36 3.486 0l8.485 15.098c.75 1.335-.214 2.985-1.743 2.985H3.515c-1.53 0-2.493-1.65-1.743-2.985L10.257 3.1ZM12 8a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0V9a1 1 0 0 1 1-1Zm0 10a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z"/></svg>`,
  info: `<svg viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10Zm0-16a1.25 1.25 0 1 0 0 2.5A1.25 1.25 0 0 0 12 6Zm1 5a1 1 0 1 0-2 0v6a1 1 0 1 0 2 0v-6Z"/></svg>`,
  loading: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-9-9"/></svg>`,
}

const CLOSE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`

// Gap between rows when the stack is fanned out on hover.
const EXPAND_GAP_PX = 12

// Newest toast (last child) is the front card at --stack-index 0; each older
// toast sits one layer deeper, peeking out behind it Sonner-style. Layers past
// MAX_VISIBLE are faded out entirely. Each toast also gets --expand-offset —
// its row position (cumulative heights of newer toasts + gaps, pointing away
// from the anchored edge) used when the hovered stack fans out into a list.
const restack = (container) => {
  const items = [...container.children]
  const direction = container.dataset.position?.startsWith(`bottom`) ? -1 : 1
  let offset = 0
  for (let i = items.length - 1; i >= 0; i--) {
    const el = items[i]
    const depth = items.length - 1 - i
    el.style.setProperty(`--stack-index`, depth)
    el.style.setProperty(`--expand-offset`, `${direction * offset}px`)
    el.style.zIndex = String(items.length - depth)
    el.classList.toggle(styles['toast--buried'], depth >= MAX_VISIBLE)
    offset += el.offsetHeight + EXPAND_GAP_PX
  }
}

// A toast without a finite duration (the `loading` default) stays until the caller's
// handle dismisses or morphs it.
const resolveDuration = (opts, resolvedType) => opts.duration ?? (resolvedType === `loading` ? Infinity : DEFAULT_DURATION)

const NOOP_HANDLE = { update: () => false, dismiss: () => {} }

export const toast = (message = `Default message`, type, options) => {
  const container = document.querySelector(`#toast`)
  if (!container) return NOOP_HANDLE

  const opts = typeof options === `number` ? { duration: options } : options ?? {}
  let resolvedType = TYPE_ALIASES[type] ?? type
  let duration = resolveDuration(opts, resolvedType)
  if (POSITIONS.has(opts.position)) container.dataset.position = opts.position

  // [popover] elements render in the browser's top layer, above regular z-index
  // stacking — re-showing moves the container to the front of that top-layer
  // order, so toasts stay above any NativePopover already open.
  if (container.matches(`:popover-open`)) container.hidePopover()
  container.showPopover()

  // Hovering anywhere on the stack fans it out row by row; enter/leave fire on
  // the container via its hit-testable children even though the container
  // itself is pointer-events: none.
  if (!container.dataset.expandBound) {
    container.dataset.expandBound = `true`
    container.addEventListener(`mouseenter`, () => container.classList.add(styles['next-toast--expanded']))
    container.addEventListener(`mouseleave`, () => container.classList.remove(styles['next-toast--expanded']))
  }

  const div = document.createElement(`div`)

  const icon = document.createElement(`span`)
  icon.className = styles['toast__icon']

  const text = document.createElement(`span`)
  text.className = styles['toast__message']
  text.textContent = message

  // Also the update() path: swaps the variant class and inserts/removes the icon in place,
  // which is what lets a `loading` toast morph into a success/danger one without remounting.
  const applyType = (nextType) => {
    resolvedType = TYPE_ALIASES[nextType] ?? nextType
    div.className = clsx(styles['toast'], styles[resolvedType])
    if (ICONS[resolvedType]) {
      icon.innerHTML = ICONS[resolvedType]
      if (!icon.isConnected) div.insertBefore(icon, text)
    } else if (icon.isConnected) {
      icon.remove()
    }
  }

  div.appendChild(text)
  applyType(type)

  const close = document.createElement(`button`)
  close.type = `button`
  close.className = styles['toast__close']
  close.innerHTML = CLOSE_ICON
  close.setAttribute(`aria-label`, `Dismiss`)
  div.appendChild(close)

  container.appendChild(div)
  restack(container)

  let timer
  let dismissed = false

  const pause = () => window.clearTimeout(timer)

  const arm = () => {
    // Infinite duration (the `loading` default) never self-dismisses — and never reaches
    // setTimeout, which would coerce Infinity to 0 and fire immediately
    if (!Number.isFinite(duration)) return
    timer = window.setTimeout(dismiss, duration)
  }

  const dismiss = () => {
    if (dismissed) return
    dismissed = true
    window.clearTimeout(timer)
    container.removeEventListener(`mouseenter`, pause)
    container.removeEventListener(`mouseleave`, arm)
    div.classList.add(styles['toast--exit'])
    div.addEventListener(
      `animationend`,
      () => {
        div.remove()
        restack(container)
      },
      { once: true }
    )
  }

  // Morphs the toast in place — message, variant, and lifetime — so a long-running action
  // can hold one `loading` card and resolve it to success/danger when it finishes. Returns
  // whether the toast was still alive to take the update, so callers can fall back to a
  // fresh toast when the user already closed this one.
  const update = (nextMessage, nextType, nextOptions) => {
    if (dismissed) return false
    const nextOpts = typeof nextOptions === `number` ? { duration: nextOptions } : nextOptions ?? {}
    duration = resolveDuration(nextOpts, TYPE_ALIASES[nextType] ?? nextType)
    if (nextMessage != null) text.textContent = nextMessage
    applyType(nextType)
    restack(container)
    pause()
    // Matches the hover-pause behavior: never restart the countdown under the reader's cursor
    if (!container.matches(`:hover`)) arm()
    return true
  }

  close.addEventListener(`click`, dismiss)
  // Hovering the (possibly expanded) stack pauses every toast's timer, not
  // just the hovered card, so nothing expires mid-read.
  container.addEventListener(`mouseenter`, pause)
  container.addEventListener(`mouseleave`, arm)

  arm()

  return { update, dismiss }
}

export default function NextToast({ position = DEFAULT_POSITION }) {
  return <div id={`toast`} popover={`manual`} data-position={POSITIONS.has(position) ? position : DEFAULT_POSITION} className={styles['next-toast']} />
}

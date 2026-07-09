'use client'

import clsx from 'clsx'
import styles from './NextToast.module.scss'

const DEFAULT_DURATION = 5000

// `error` is the type used across the app, `danger` is the actual style variant.
const TYPE_ALIASES = {
  error: 'danger',
}

const ICONS = {
  success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/></svg>`,
  danger: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`,
  warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
}

const CLOSE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`

export const toast = (message = `Default message`, type, duration = DEFAULT_DURATION) => {
  const container = document.querySelector(`#toast`)
  if (!container) return

  // [popover] elements render in the browser's top layer, above regular z-index
  // stacking — re-showing moves the container to the front of that top-layer
  // order, so toasts stay above any NativePopover already open.
  if (container.matches(`:popover-open`)) container.hidePopover()
  container.showPopover()

  const resolvedType = TYPE_ALIASES[type] ?? type

  const div = document.createElement(`div`)
  div.className = clsx(styles['toast'], styles[resolvedType], 'animate', 'pop')

  if (ICONS[resolvedType]) {
    const icon = document.createElement(`span`)
    icon.className = styles['toast__icon']
    icon.innerHTML = ICONS[resolvedType]
    div.appendChild(icon)
  }

  const text = document.createElement(`span`)
  text.className = styles['toast__message']
  text.textContent = message
  div.appendChild(text)

  const close = document.createElement(`button`)
  close.type = `button`
  close.className = styles['toast__close']
  close.innerHTML = CLOSE_ICON
  close.setAttribute(`aria-label`, `Dismiss`)
  div.appendChild(close)

  container.appendChild(div)

  let timer

  const dismiss = () => {
    window.clearTimeout(timer)
    // Drop the global entrance-animation classes so their keyframe (a fade back to
    // visible) can't race with toast--exit for the animation-name property.
    div.classList.remove(`animate`, `pop`)
    div.classList.add(styles['toast--exit'])
    div.addEventListener(`animationend`, () => div.remove(), { once: true })
  }

  const arm = () => {
    timer = window.setTimeout(dismiss, duration)
  }

  close.addEventListener(`click`, dismiss)
  div.addEventListener(`mouseenter`, () => window.clearTimeout(timer))
  div.addEventListener(`mouseleave`, arm)

  arm()
}

export default function NextToast() {
  return <div id={`toast`} popover={`manual`} className={clsx(styles['next-toast'], 'd-flex align-items-center flex-column text-center')} />
}

import React from 'react'
import clsx from 'clsx'
import { Clock, Ring } from 'loading-dev'
import styles from './Loading.module.scss'

// Swap this for any other loading-dev export to restyle every spinner in the app.
const Indicator = Ring

// Every loading indicator uses the app's primary color, including legacy color overrides.
const DEFAULT_COLOR = 'var(--app-accent, #1d9bf0)'

// Call sites pass CSS lengths ('14px'); loading-dev takes a number of pixels.
const toPixels = (size, fallback) => {
  const parsed = typeof size === 'number' ? size : Number.parseFloat(size)
  return Number.isFinite(parsed) ? parsed : fallback
}

// Primitive Loader Component — loading-dev marks its own svg aria-hidden, so the label lives here.
export const Spinner = ({ size = 32, className, label = 'Loading', ...rest }) => (
  <span className={clsx(styles.spinner, className)} role="status" aria-label={label}>
    <Indicator {...rest} color={DEFAULT_COLOR} size={toPixels(size, 32)} />
  </span>
)

// Full-Screen Blocking Loader
export const GlobalLoader = ({ message = 'Loading, please wait...' }) => (
  <div className={styles.globalLoader} aria-busy="true">
    <div className={clsx(styles.globalLoader__container, 'd-f-c', 'flex-column', 'gap-025')}>
      <Spinner size={24} />
      <p className={styles.globalLoader__message}>{message}</p>
    </div>
  </div>
)

// Localized, Content-Specific Loader
export const ContentSpinner = ({ size = 24, color, className }) => (
  <div className={clsx(styles.contentSpinner, 'd-f-c', className)} aria-busy="true">
    <Spinner color={color} label="Content loading" size={size} />
  </div>
)

// Page and main-content loading states share one size and placement.
export const PageLoader = ({ label = 'Loading page' }) => (
  <div className={styles['page-loader']} aria-busy="true">
    <Spinner size={24} label={label} />
  </div>
)

// Linear loading
export const LinearLoading = () => (
  <div className={styles.loading}>
    <Spinner />
  </div>
)

// The chat message status slot: a ticking clock until it turns into the 12px sent check.
export const MessageLoader = () => (
  <span className={styles.spinner} role="status" aria-label="Sending">
    <Clock color={DEFAULT_COLOR} size={12} />
  </span>
)

// Keep the shared AI status slot on the app's loading indicator.
export const ThinkingOrb = ({ size = 18, label = 'Thinking', className }) => (
  <Spinner size={size} label={label} className={className} />
)

export default GlobalLoader

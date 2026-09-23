import React from 'react'
import clsx from 'clsx'
import { Ring } from 'loading-dev'
import styles from './Loading.module.scss'

// Swap this for any other loading-dev export to restyle every spinner in the app.
const Indicator = Ring

// --network-color-primary is runtime-only, so the literal fallback has to stay.
const DEFAULT_COLOR = 'var(--network-color-primary, #1D9BF0)'

// Call sites pass CSS lengths ('14px'); loading-dev takes a number of pixels.
const toPixels = (size, fallback) => {
  const parsed = typeof size === 'number' ? size : Number.parseFloat(size)
  return Number.isFinite(parsed) ? parsed : fallback
}

// Primitive Loader Component — loading-dev marks its own svg aria-hidden, so the label lives here.
export const Spinner = ({ size = 32, color = DEFAULT_COLOR, className, label = 'Loading', ...rest }) => (
  <span className={clsx(styles.spinner, className)} role="status" aria-label={label}>
    <Indicator {...rest} color={color} size={toPixels(size, 32)} />
  </span>
)

// Full-Screen Blocking Loader
export const GlobalLoader = ({ message = 'Loading, please wait...' }) => (
  <div className={styles.globalLoader} aria-busy="true">
    <div className={clsx(styles.globalLoader__container, 'd-f-c', 'flex-column', 'gap-025')}>
      <Spinner size={64} />
      <p className={styles.globalLoader__message}>{message}</p>
    </div>
  </div>
)

// Localized, Content-Specific Loader
export const ContentSpinner = ({ size = 20, color, className }) => (
  <div className={clsx(styles.contentSpinner, 'd-f-c', className)} aria-busy="true">
    <Spinner color={color} label="Content loading" size={size} />
  </div>
)

// Linear loading
export const LinearLoading = () => (
  <div className={styles.loading}>
    <div className={clsx(styles.loading__container, 'd-f-c', 'flex-column')}>
      <div />
    </div>
  </div>
)

// Sits beside a 12px check icon in the chat message status slot.
export const MessageLoader = () => <Spinner color="currentColor" label="Sending" size={12} />

export default GlobalLoader

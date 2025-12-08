import React from 'react'
import styles from './Loading.module.scss'

// Primitive Loader Component
export const Spinner = ({ size = '32px', strokeWidth = '2', strokeColor = '#FAFAFA', color = 'var(--network-color-primary, #1D9BF0)' }) => (
  <svg height={size} viewBox="0 0 32 32" width={size} role="img" aria-label="Loading spinner">
    <circle cx="16" cy="16" r="14" fill="none" strokeWidth={strokeWidth} stroke={strokeColor} opacity=".2" />
    <circle cx="16" cy="16" r="14" fill="none" strokeWidth={strokeWidth} stroke={color} strokeDasharray="80" strokeDashoffset="60">
      <animateTransform attributeName="transform" attributeType="XML" type="rotate" dur="1s" from="0 16 16" to="360 16 16" repeatCount="indefinite" />
    </circle>
  </svg>
)

// Full-Screen Blocking Loader
export const GlobalLoader = ({ message = 'Loading, please wait...' }) => (
  <div className={styles.globalLoader} aria-live="polite" aria-busy="true">
    <div className={`${styles.globalLoader__container} d-f-c flex-column gap-025`}>
      <Spinner size="64px" />
      <p className={styles.globalLoader__message}>{message}</p>
    </div>
  </div>
)

// Localized, Content-Specific Loader
export const ContentSpinner = ({ size = '20px', color = '#424242' }) => (
  <div className={`${styles.contentSpinner} d-f-c`} aria-live="polite" aria-label="Content loading">
    <Spinner size={size} color={color} />
  </div>
)

// Linear loading 
export const LinearLoading = () => (
  <div className={styles.loading}>
    <div className={`${styles.loading__container} d-f-c flex-column`}>
      <div />
    </div>
  </div>
)

export default GlobalLoader
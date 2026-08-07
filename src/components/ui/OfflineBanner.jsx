// OfflineBanner.jsx
'use client'

import { useOffline } from 'next/offline'
import styles from './OfflineBanner.module.scss'

/**
 * Persistent "you're offline" pill.
 *
 * useOffline() beats navigator.onLine here: it also flips when a framework request fails while
 * the OS still claims the interface is up (captive portal, dead DNS, unreachable origin), and
 * flips back off a successful connectivity poll rather than a bare `online` event.
 */
export default function OfflineBanner() {
  const isOffline = useOffline()

  if (!isOffline) return null

  return (
    <div className={styles['offline-banner']} role="status" aria-live="polite">
      <span className={styles['offline-banner__dot']} aria-hidden="true" />
      You’re offline. Showing what’s already loaded.
    </div>
  )
}

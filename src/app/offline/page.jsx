'use client'

import { useOffline } from 'next/offline'
import clsx from 'clsx'
import styles from './page.module.scss'

/**
 * Last-resort fallback the service worker precaches at install and serves when a navigation
 * finds neither the requested document nor a cached app shell. Reaching this means the visitor
 * has never loaded that route online, so it stays self-contained — no data fetching.
 */
export default function OfflinePage() {
  const isOffline = useOffline()

  return (
    <div className={clsx('__container', styles.offline)} data-width="small">
      <h1 className={styles.offline__title}>You’re offline</h1>

      <p className={styles.offline__message}>
        {isOffline
          ? 'This page hasn’t been loaded on this device yet, so there’s nothing cached to show. It will load as soon as you’re back online.'
          : 'You’re back online — reload to pick up where you left off.'}
      </p>

      <button type="button" className={styles.offline__retry} onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  )
}

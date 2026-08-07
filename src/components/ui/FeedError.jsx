// FeedError.jsx
'use client'

import { useEffect, useRef } from 'react'
import { useOffline } from 'next/offline'
import clsx from 'clsx'
import styles from './FeedError.module.scss'

/**
 * Terminal state for a feed whose first page failed to load. Client fetch() sits outside the
 * framework's offline retry (that only covers navigations, prefetches and Server Actions), so
 * without this a dead request leaves the skeleton shimmering forever.
 *
 * Reconnecting retries on its own — the button is the manual escape hatch for a request that
 * failed while the connection was up.
 */
export default function FeedError({ message, onRetry, isRetrying = false }) {
  const isOffline = useOffline()
  const wasOfflineRef = useRef(isOffline)

  useEffect(() => {
    if (wasOfflineRef.current && !isOffline) onRetry?.()
    wasOfflineRef.current = isOffline
  }, [isOffline, onRetry])

  const copy = message ?? (isOffline ? 'You’re offline. Check your connection.' : 'Something went wrong. Try reloading.')

  return (
    <div className={styles['feed-error']} role="status">
      <p className={styles['feed-error__message']}>{copy}</p>

      <button type="button" className={styles['feed-error__retry']} onClick={onRetry} disabled={isRetrying}>
        <svg
          className={clsx(styles['feed-error__icon'], isRetrying && styles['feed-error__icon--spinning'])}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <polyline points="21 3 21 9 15 9" />
        </svg>
        {isRetrying ? 'Retrying' : 'Retry'}
      </button>
    </div>
  )
}

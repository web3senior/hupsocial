'use client'

import { useOffline } from 'next/offline'
import clsx from 'clsx'
import { PageLoader } from '@/components/Loading'
import styles from './loading.module.scss'

/**
 * Fallback for every route that doesn't ship its own loading.jsx.
 *
 * It is also what makes offline navigation work: with experimental.useOffline enabled, Next
 * holds a network-blocked navigation pending instead of throwing to error.jsx, and this is the
 * boundary it renders in the meantime. Without a loading boundary there is nothing to show and
 * the click reads as dead. Deliberately shape-neutral — it stands in for any route.
 */
export default function Loading({ containerWidth = 'small', headerClearance = true }) {
  const isOffline = useOffline()

  return (
    <div className={clsx('__container', styles.loading, !headerClearance && styles['loading--inline'])} data-width={containerWidth} aria-busy="true" aria-label="Loading page">
      <PageLoader />

      {isOffline && (
        <p className={styles.loading__status} role="status">
          Waiting for connection…
        </p>
      )}
    </div>
  )
}

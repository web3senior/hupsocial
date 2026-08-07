'use client'

import { useOffline } from 'next/offline'
import clsx from 'clsx'
import styles from './loading.module.scss'

/**
 * Fallback for every route that doesn't ship its own loading.jsx.
 *
 * It is also what makes offline navigation work: with experimental.useOffline enabled, Next
 * holds a network-blocked navigation pending instead of throwing to error.jsx, and this is the
 * boundary it renders in the meantime. Without a loading boundary there is nothing to show and
 * the click reads as dead. Deliberately shape-neutral — it stands in for any route.
 */
export default function Loading() {
  const isOffline = useOffline()

  return (
    <div className={clsx('__container', styles.loading)} data-width="small">
      <div className={styles.loading__header}>
        <div className={clsx('shimmer', 'rounded', styles['loading__title'])} />
      </div>

      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className={styles.loading__row} aria-hidden="true">
          <div className={clsx('shimmer', 'rounded', styles['loading__avatar'])} />
          <div className={styles.loading__lines}>
            <div className={clsx('shimmer', 'rounded', styles['loading__line'], styles['loading__line--short'])} />
            <div className={clsx('shimmer', 'rounded', styles['loading__line'])} />
          </div>
        </div>
      ))}

      {isOffline && (
        <p className={styles.loading__status} role="status">
          Waiting for connection…
        </p>
      )}
    </div>
  )
}

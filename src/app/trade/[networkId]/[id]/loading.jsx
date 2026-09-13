'use client'

import { useOffline } from 'next/offline'
import clsx from 'clsx'
import styles from '../../../loading.module.scss'
import pageStyles from './page.module.scss'

/**
 * Skeleton for one launch.
 *
 * The root boundary is a narrow feed shape, and this page is a full-width trading workspace — so
 * without its own boundary the layout visibly jumps from a column to three the moment data lands.
 * This stands in at the same width and roughly the same shape it is about to become.
 */
export default function Loading() {
  const isOffline = useOffline()

  return (
    <div className={pageStyles.page}>
      <div className={clsx('__container', pageStyles.page__container)} data-width="full">
        <div className={styles.loading__header}>
          <div className={clsx('shimmer', 'rounded', styles['loading__title'])} />
        </div>

        <div className={pageStyles.page__skeleton} aria-hidden="true">
          <div className={clsx('shimmer', 'rounded', pageStyles['page__skeleton-chart'])} />
          <div className={clsx('shimmer', 'rounded', pageStyles['page__skeleton-ticket'])} />
        </div>

        {isOffline && (
          <p className={styles.loading__status} role="status">
            Waiting for connection…
          </p>
        )}
      </div>
    </div>
  )
}

import Link from 'next/link'
import clsx from 'clsx'
import styles from './not-found.module.scss'

// Renders inside the root layout, so it wears data-theme — the built-in 404 only reads the OS scheme.
export default function NotFound() {
  return (
    <div className={clsx('__container', styles['not-found'])} data-width="small">
      <p className={styles['not-found__code']}>404</p>

      <h1 className={styles['not-found__title']}>This page doesn’t exist</h1>

      <p className={styles['not-found__message']}>
        The link may be broken, or the page may have moved. Check the address, or head back to the feed.
      </p>

      <div className={styles['not-found__actions']}>
        <Link href="/" className={clsx(styles['not-found__action'], styles['not-found__action--primary'])}>
          Back to feed
        </Link>
        <Link href="/search" className={styles['not-found__action']}>
          Search
        </Link>
      </div>
    </div>
  )
}

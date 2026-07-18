import styles from './loading.module.scss'

/**
 * Instant route-level fallback for the profile page. Because this shell is
 * prefetched alongside the <Link>, navigation from the feed paints immediately
 * instead of waiting on the server render (profile fetch chain).
 */
export default function Loading() {
  return (
    <div className={styles.loading}>
      <div className={`__container ${styles.loading__container}`} data-width="small">
        <div className={`shimmer ${styles.loading__profile}`} />
        <div className={`shimmer ${styles.loading__tabs}`} />
        <div className={`shimmer ${styles.loading__post}`} />
        <div className={`shimmer ${styles.loading__post}`} />
      </div>
    </div>
  )
}

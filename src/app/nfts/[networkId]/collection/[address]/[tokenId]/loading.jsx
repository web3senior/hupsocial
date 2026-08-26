import PageTitle from '@/components/PageTitle'
import styles from './loading.module.scss'

/**
 * Instant route-level fallback for the token detail page. Because this shell is prefetched
 * alongside the <Link>, navigating from a collection tile paints immediately instead of waiting
 * on the server render (generateMetadata's metadata fetch), mirroring the listing page's shell.
 */
export default function Loading() {
  return (
    <>
      <PageTitle name="NFT" />
      <div className={styles.loading}>
        <div className={`__container ${styles.loading__container}`} data-width="large">
          <div className={styles.loading__layout}>
            <div className={`shimmer ${styles.loading__media}`} />
            <div className={styles.loading__info}>
              <div className={`shimmer ${styles.loading__line} ${styles['loading__line--collection']}`} />
              <div className={`shimmer ${styles.loading__line} ${styles['loading__line--title']}`} />
              <div className={`shimmer ${styles.loading__line} ${styles['loading__line--stats']}`} />
              <div className={`shimmer ${styles.loading__card}`} />
              <div className={`shimmer ${styles.loading__section}`} />
              <div className={`shimmer ${styles.loading__section}`} />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

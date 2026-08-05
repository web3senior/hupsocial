import PageTitle from '@/components/PageTitle'
import styles from './loading.module.scss'

/**
 * Instant route-level fallback for the listing detail page. Because this shell
 * is prefetched alongside the <Link>, navigation from a market card paints
 * immediately instead of waiting on the server render (generateMetadata's
 * listing fetch), mirroring the profile page's loading shell.
 */
export default function Loading() {
  return (
    <>
      <PageTitle name="NFT listing" />
      <div className={styles.loading}>
        <div className={`__container ${styles.loading__container}`} data-width="large">
          <div className={styles.loading__layout}>
            <div className={`shimmer ${styles.loading__media}`} />
            <div className={styles.loading__info}>
              <div className={`shimmer ${styles.loading__line} ${styles['loading__line--badges']}`} />
              <div className={`shimmer ${styles.loading__line} ${styles['loading__line--title']}`} />
              <div className={`shimmer ${styles.loading__line}`} />
              <div className={`shimmer ${styles.loading__line}`} />
              <div className={`shimmer ${styles.loading__block}`} />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

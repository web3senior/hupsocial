import PageTitle from '@/components/PageTitle'
import styles from './loading.module.scss'

/**
 * Instant route-level fallback for the drop detail page, mirroring the NFT listing
 * page's shell: prefetched alongside the <Link>, so navigation from a DropCard
 * paints immediately instead of waiting on the server render.
 */
export default function Loading() {
  return (
    <>
      <PageTitle name="NFT drop" />
      <div className={styles.loading}>
        <div className={`__container ${styles.loading__container}`} data-width="large">
          <div className={styles.loading__layout}>
            <div className={`shimmer ${styles.loading__media}`} />
            <div className={styles.loading__info}>
              <div className={`shimmer ${styles.loading__line} ${styles['loading__line--badges']}`} />
              <div className={`shimmer ${styles.loading__line} ${styles['loading__line--title']}`} />
              <div className={`shimmer ${styles.loading__line}`} />
              <div className={`shimmer ${styles.loading__block}`} />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

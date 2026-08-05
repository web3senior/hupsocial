import PageTitle from '@/components/PageTitle'
import styles from './loading.module.scss'

/**
 * Instant route-level fallback for the collection page. Because this shell is
 * prefetched alongside the <Link>, navigation from the market hero or a listing
 * paints immediately instead of waiting on the server render (generateMetadata's
 * collection fetch), mirroring the profile page's loading shell.
 */
export default function Loading() {
  return (
    <>
      <PageTitle name="NFT collection" />
      <div className={styles.loading}>
        <div className={`__container ${styles.loading__container}`} data-width="large">
          <div className={`shimmer ${styles.loading__banner}`} />
          <div className={`shimmer ${styles.loading__identity}`} />
          <div className={`shimmer ${styles.loading__address}`} />
          <div className={styles.loading__grid}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={`shimmer ${styles.loading__tile}`} />
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

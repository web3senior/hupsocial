import { SkeletonRows } from './_components/ActivityFeed'
import PageTitle from '@/components/PageTitle'
import styles from './page.module.scss'

// Same shell and skeleton the feed paints on its first fetch, so the route swap never jumps from
// a centred spinner to rows.
export default function Loading() {
  return (
    <>
      <PageTitle name="Notifications" />
      <div className={styles.page}>
        <div className={`__container ${styles.page__container}`} data-width="small">
          <SkeletonRows />
        </div>
      </div>
    </>
  )
}

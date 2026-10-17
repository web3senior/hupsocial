import { SkeletonRows } from './_components/ActivityFeed'
import styles from './page.module.scss'

// Same shell and skeleton the feed paints on its first fetch, so the route swap never jumps from
// a centred spinner to rows.
export default function Loading() {
  return (
    <div className={styles.page}>
      <div className={`__container ${styles.page__container}`} data-width="medium">
        <SkeletonRows />
      </div>
    </div>
  )
}

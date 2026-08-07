// PostSkeleton.jsx
import clsx from 'clsx'
import styles from './PostSkeleton.module.scss'

/**
 * Placeholder for a single timeline row: avatar, handle, one line of body. Extracted from
 * HomeFeedTab so every feed (For you, Following, Trending, Status) shows the same shape while
 * its first page is in flight — and so the shape is already in the bundle when a cached shell
 * boots with no network.
 */
export const PostSkeleton = () => (
  <div className={styles['post-skeleton']}>
    <div className={clsx('flex', 'flex-row', 'align-items-start', 'gap-1')}>
      <div className={clsx('shimmer', 'rounded')} style={{ width: `36px`, height: `36px` }} />
      <div className={clsx('flex', 'flex-column', 'gap-025', 'flex-1')}>
        <div className={clsx('shimmer', 'rounded')} style={{ width: `20%`, height: `12px` }} />
        <div className={clsx('shimmer', 'rounded')} style={{ width: `90%`, height: `12px` }} />
      </div>
    </div>
  </div>
)

export default function PostSkeletonGrid({ count = 14 }) {
  return (
    <div className={clsx('flex', 'flex-column', 'gap-2', 'mb-10')} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <PostSkeleton key={i} />
      ))}
    </div>
  )
}

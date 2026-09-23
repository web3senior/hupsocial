// PostSkeleton.jsx
import clsx from 'clsx'
import styles from './PostSkeleton.module.scss'

const NAME_WIDTHS = ['27%', '22%', '24%', '21%', '18%']
const LINE_WIDTHS = ['53%', '77%', '62%', '63%', '70%']
const ACTION_COUNT = 4

/**
 * Placeholder for a single timeline row: avatar with chain badge, handle, two lines of body and
 * the action row. Extracted from HomeFeedTab so every feed (For you, Following, Trending, Status)
 * shows the same shape while its first page is in flight — and so the shape is already in the
 * bundle when a cached shell boots with no network.
 */
export const PostSkeleton = ({ variant = 0, divided = false }) => {
  const i = variant % NAME_WIDTHS.length

  return (
    <div className={clsx(styles['post-skeleton'], divided && styles['post-skeleton--divided'])}>
      <div className={styles['post-skeleton__avatar']}>
        <div className={clsx('shimmer', styles['post-skeleton__avatar-image'])} />
        <div className={clsx('shimmer', styles['post-skeleton__avatar-badge'])} />
      </div>

      <div className={styles['post-skeleton__main']}>
        <div className={styles['post-skeleton__header']}>
          <div className={clsx('shimmer', styles['post-skeleton__bar'])} style={{ width: NAME_WIDTHS[i] }} />
          <div className={clsx('shimmer', styles['post-skeleton__bar'], styles['post-skeleton__bar--chip'])} />
          <div className={clsx('shimmer', styles['post-skeleton__menu'])} />
        </div>

        <div className={styles['post-skeleton__body']}>
          <div className={clsx('shimmer', styles['post-skeleton__bar'])} />
          <div className={clsx('shimmer', styles['post-skeleton__bar'])} style={{ width: LINE_WIDTHS[i] }} />
        </div>

        <div className={styles['post-skeleton__actions']}>
          {Array.from({ length: ACTION_COUNT }).map((_, j) => (
            <div key={j} className={clsx('shimmer', styles['post-skeleton__action'])} />
          ))}
        </div>
      </div>
    </div>
  )
}

export default function PostSkeletonGrid({ count = 14 }) {
  return (
    <div className={clsx(styles['post-skeleton-grid'], 'mb-10')} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <PostSkeleton key={i} variant={i} divided />
      ))}
    </div>
  )
}

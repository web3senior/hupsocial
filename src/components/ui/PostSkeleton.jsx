// PostSkeleton.jsx
import clsx from 'clsx'
import styles from './PostSkeleton.module.scss'

// Each variant is a name width plus its body lines, so a feed of skeletons mixes one-liners
// with the odd longer post instead of repeating one shape
const VARIANTS = [
  { name: '24%', lines: ['48%'] },
  { name: '15%', lines: ['100%', '100%', '83%'] },
  { name: '16%', lines: ['52%'] },
  { name: '22%', lines: ['48%'] },
  { name: '20%', lines: ['72%'] },
  { name: '20%', lines: ['46%'] },
]
const ACTION_COUNT = 4

/**
 * Placeholder for a single timeline row: avatar with its chain badge, handle and chip, the
 * overflow menu, one or three lines of body and the action row. Extracted from HomeFeedTab so
 * every feed (For you, Following, Trending, Status) shows the same shape while its first page is
 * in flight — and so the shape is already in the bundle when a cached shell boots with no network.
 */
export const PostSkeleton = ({ variant = 0, divided = false }) => {
  const { name, lines } = VARIANTS[variant % VARIANTS.length]

  return (
    <div className={clsx(styles['post-skeleton'], divided && styles['post-skeleton--divided'])}>
      <div className={styles['post-skeleton__avatar']}>
        <div className={clsx('shimmer', styles['post-skeleton__avatar-image'])} />
        <div className={clsx('shimmer', styles['post-skeleton__avatar-badge'])} />
      </div>

      <div className={styles['post-skeleton__main']}>
        <div className={styles['post-skeleton__header']}>
          <div className={clsx('shimmer', styles['post-skeleton__bar'])} style={{ width: name }} />
          <div className={clsx('shimmer', styles['post-skeleton__bar'], styles['post-skeleton__bar--chip'])} />
          <div className={clsx('shimmer', styles['post-skeleton__menu'])} />
        </div>

        <div className={styles['post-skeleton__body']}>
          {lines.map((width, j) => (
            <div key={j} className={clsx('shimmer', styles['post-skeleton__bar'])} style={{ width }} />
          ))}
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

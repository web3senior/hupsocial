// CommentSkeleton.jsx
import clsx from 'clsx'
import styles from './CommentSkeleton.module.scss'

/**
 * Placeholder for a single reply row: avatar, handle, body lines, action bar. Mirrors the
 * padding of a real `.post` so the swap from skeleton to thread doesn't jump, and is shared
 * between Comments and the post route's loading.jsx so both boundaries shimmer identically.
 */
export const CommentSkeleton = ({ widths = ['88%', '54%'] }) => (
  <div className={styles['comment-skeleton']}>
    <div className={clsx(styles['comment-skeleton__avatar'], 'shimmer')} />
    <div className={styles['comment-skeleton__body']}>
      <div className={clsx(styles['comment-skeleton__handle'], 'shimmer')} />
      {widths.map((width, i) => (
        <div key={i} className={clsx(styles['comment-skeleton__line'], 'shimmer')} style={{ width }} />
      ))}
      <div className={styles['comment-skeleton__actions']}>
        {[44, 40, 40, 36].map((width, i) => (
          <div key={i} className={clsx(styles['comment-skeleton__pill'], 'shimmer')} style={{ width }} />
        ))}
      </div>
    </div>
  </div>
)

// Line widths cycle per row so a stack of them doesn't read as a mechanical grid.
const ROW_WIDTHS = [
  ['88%', '54%'],
  ['72%'],
  ['92%', '66%'],
]

export default function CommentSkeletonList({ count = 3 }) {
  return (
    <div className={styles['comment-skeleton-list']} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <CommentSkeleton key={i} widths={ROW_WIDTHS[i % ROW_WIDTHS.length]} />
      ))}
    </div>
  )
}

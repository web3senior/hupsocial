'use client'

import Link from 'next/link'
import styles from './TopPostsList.module.scss'

const numberFormatter = new Intl.NumberFormat(undefined, { notation: 'compact' })

function excerptOf(content) {
  if (!content || typeof content !== 'object') return typeof content === 'string' ? content : ''
  const textElement = content.elements?.find((el) => el.type === 'text')
  return textElement?.data?.text || ''
}

export default function TopPostsList({ posts }) {
  if (!posts?.length) {
    return <p className={styles.topPosts__empty}>No post activity in this period yet.</p>
  }

  return (
    <ol className={styles.topPosts}>
      {posts.map((post) => (
        <li key={`${post.network_id}-${post.post_id}`} className={styles.topPosts__item}>
          <Link href={`/networks/${post.network_id}/${post.post_id}`} className={styles.topPosts__link}>
            <span className={styles.topPosts__excerpt}>{excerptOf(post.content) || 'View post'}</span>
            <span className={styles.topPosts__stats}>
              <span>{numberFormatter.format(post.views)} views</span>
              <span>{numberFormatter.format(post.likes)} likes</span>
              <span>{numberFormatter.format(post.comments)} comments</span>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  )
}

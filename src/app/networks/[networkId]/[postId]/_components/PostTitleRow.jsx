'use client'

import BackLink from '@/components/ui/BackLink'
import { postHeaderProps } from './postHeader'
import styles from './PostTitleRow.module.scss'

/**
 * "← Post · 232 views" above the post's card, as Threads sets its thread page: the title outside
 * the container, the card starting under it. On a desktop it sits in the fixed header's own strip
 * (Header goes bare on post routes), so no empty band opens above it. Shared by PostDetails and
 * loading.jsx so the row does not move when the route boundary swaps.
 * @param {Object} props
 * @param {Object|null} props.post The row on screen; null while it is still loading.
 * @param {string} props.networkId
 */
export default function PostTitleRow({ post, networkId }) {
  const { backHref, backLabel, subtitle } = postHeaderProps(post, networkId)

  return (
    <div className={styles['post-title']}>
      <BackLink href={backHref} label={backLabel} className={styles['post-title__back']} />
      <div className={styles['post-title__heading']}>
        <h1 className={styles['post-title__name']}>Post</h1>
        {subtitle && <p className={styles['post-title__subtitle']}>{subtitle}</p>}
      </div>
    </div>
  )
}

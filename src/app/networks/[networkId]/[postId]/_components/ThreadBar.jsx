'use client'

import { useRef } from 'react'
import clsx from 'clsx'
import { ArrowsDownUpIcon, CaretDownIcon, CaretRightIcon, CheckIcon } from '@phosphor-icons/react'
import NativePopover from '@/components/ui/NativePopover'
import PostActivityDialog from './PostActivityDialog'
import styles from './ThreadBar.module.scss'

const SORT_LABELS = { top: 'Top', latest: 'Latest' }

/**
 * The row between a post and its replies, as on Threads: how the replies are ordered, and the
 * way into who liked, tipped and reposted it.
 * @param {Object} props
 * @param {Object|null} props.post The thread root; null leaves out View activity.
 * @param {string|number} props.networkId
 * @param {'top'|'latest'} props.sort
 * @param {Function} props.onSortChange
 */
export default function ThreadBar({ post, networkId, sort, onSortChange }) {
  const activityRef = useRef(null)

  return (
    <div className={styles['thread-bar']}>
      <NativePopover
        placement="bottom-start"
        trigger={
          <button type="button" className={styles['thread-bar__sort']} aria-label={`Sort replies, now ${SORT_LABELS[sort]}`}>
            <ArrowsDownUpIcon size={18} aria-hidden="true" />
            {SORT_LABELS[sort]}
            <CaretDownIcon size={14} aria-hidden="true" />
          </button>
        }
      >
        {({ close }) => (
          <div className={styles['thread-bar__menu']} role="menu">
            {Object.entries(SORT_LABELS).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={sort === value}
                className={clsx(styles['thread-bar__option'], sort === value && styles['thread-bar__option--active'])}
                onClick={() => {
                  onSortChange(value)
                  close()
                }}
              >
                {label}
                {sort === value && <CheckIcon size={16} weight="bold" aria-hidden="true" />}
              </button>
            ))}
          </div>
        )}
      </NativePopover>

      {post && (
        <>
          <button type="button" className={styles['thread-bar__activity']} onClick={() => activityRef.current?.open()}>
            View activity
            <CaretRightIcon size={16} aria-hidden="true" />
          </button>

          <PostActivityDialog ref={activityRef} post={post} networkId={networkId} />
        </>
      )}
    </div>
  )
}

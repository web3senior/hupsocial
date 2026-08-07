'use client'

import { useState, useEffect, useCallback } from 'react'
import clsx from 'clsx'
import { getStatuses } from '@/lib/api'
import Profile from '@/components/Profile'
import PostSkeletonGrid from '@/components/ui/PostSkeleton'
import FeedError from '@/components/ui/FeedError'
import pageStyles from '@/app/page.module.scss'
import styles from './StatusFeedTab.module.scss'

const STATUSES_PAGE_SIZE = 20

/**
 * Multichain feed of every wallet's latest onchain Status broadcast, backed
 * by the `statuses` table synced by the cidex indexer's HupStatus sync.
 * Distinct from the single-status widget in UserProfile.jsx - this is a
 * many-users list.
 */
export default function StatusFeedTab() {
  const [statuses, setStatuses] = useState([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [isFetching, setIsFetching] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    let cancelled = false

    getStatuses(1, STATUSES_PAGE_SIZE)
      .then((res) => {
        if (cancelled) return
        setStatuses(res?.data || [])
        setHasMore(res?.meta?.hasMore || false)
        setPage(1)
        setLoadError(false)
      })
      .catch((error) => {
        console.error('Status feed error:', error)
        // Otherwise a failed load falls through to the "no statuses right now" copy.
        if (!cancelled) setLoadError(true)
      })
      .finally(() => {
        if (!cancelled) setIsLoaded(true)
      })

    return () => {
      cancelled = true
    }
  }, [retryNonce])

  const handleRetry = useCallback(() => {
    setLoadError(false)
    setIsLoaded(false)
    setRetryNonce((nonce) => nonce + 1)
  }, [])

  const loadMore = useCallback(async () => {
    if (isFetching || !hasMore) return
    setIsFetching(true)
    const nextPage = page + 1

    try {
      const res = await getStatuses(nextPage, STATUSES_PAGE_SIZE)
      if (res?.success && res.data.length > 0) {
        setStatuses((prev) => [...prev, ...res.data])
        setPage(nextPage)
      }
      setHasMore(res?.meta?.hasMore || false)
    } catch (error) {
      console.error('Status feed load-more error:', error)
    } finally {
      setIsFetching(false)
    }
  }, [isFetching, hasMore, page])

  if (loadError) {
    return (
      <FeedPanel>
        <FeedError onRetry={handleRetry} />
      </FeedPanel>
    )
  }

  if (!isLoaded) {
    return (
      <FeedPanel>
        <PostSkeletonGrid count={8} />
      </FeedPanel>
    )
  }

  if (statuses.length === 0) {
    return (
      <FeedPanel>
        <p className={clsx('text-center', 'p-100')}>No statuses right now. Statuses last as long as their creators choose.</p>
      </FeedPanel>
    )
  }

  return (
    <div className={clsx('__container')} data-width="small">
      <div className={clsx('__container', pageStyles.page__container)} data-width="medium">
        <div className={styles['status-feed']}>
          {statuses.map((item) => (
            <article key={`${item.network_id}-${item.id}`} className={styles['status-feed__item']}>
              <Profile creator={item.wallet_address} createdAt={item.event_timestamp} networkId={Number(item.network_id)} />
              <p className={styles['status-feed__content']}>{item.content}</p>
            </article>
          ))}
        </div>
      </div>

      {hasMore && (
        <div className="flex justify-content-center p-100">
          <button className={styles['status-feed__load-more']} onClick={loadMore} disabled={isFetching}>
            {isFetching ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}
    </div>
  )
}

// Shared column chrome, so the skeleton, the retry card and the empty copy all land in the same
// place the statuses would have.
const FeedPanel = ({ children }) => (
  <div className={clsx('__container')} data-width="small">
    <div className={clsx('__container', pageStyles.page__container)} data-width="medium">
      {children}
    </div>
  </div>
)

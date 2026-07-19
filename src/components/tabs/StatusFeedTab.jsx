'use client'

import { useState, useEffect, useCallback } from 'react'
import clsx from 'clsx'
import { getStatuses } from '@/lib/api'
import Profile from '@/components/Profile'
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

  useEffect(() => {
    let cancelled = false

    getStatuses(1, STATUSES_PAGE_SIZE)
      .then((res) => {
        if (cancelled) return
        setStatuses(res?.data || [])
        setHasMore(res?.meta?.hasMore || false)
        setPage(1)
      })
      .catch((error) => console.error('Status feed error:', error))
      .finally(() => {
        if (!cancelled) setIsLoaded(true)
      })

    return () => {
      cancelled = true
    }
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

  if (isLoaded && statuses.length === 0) {
    return (
      <div className={clsx('__container')} data-width="small">
        <div className={clsx('__container', pageStyles.page__container)} data-width="medium">
          <p className={clsx('text-center', 'p-100')}>No statuses right now. Statuses last as long as their creators choose.</p>
        </div>
      </div>
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

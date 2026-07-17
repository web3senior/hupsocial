'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect, useCallback } from 'react'
import { useConnection } from 'wagmi'
import clsx from 'clsx'
import { getTrendingPosts } from '@/lib/api'
import { useClientMounted } from '@/hooks/useClientMount'
import { PostCard } from '@/components/Post'
import styles from '@/app/page.module.scss'

const POSTS_PAGE_SIZE = 20

// Meta value the API reports when the 24h window was empty and the ranking
// fell back to the trailing week (see TRENDING_WINDOWS_HOURS in the posts route)
const WEEK_WINDOW_HOURS = 168

/**
 * Feed of posts ranked by engagement velocity (likes + comments received in
 * the trailing window) across all public posts and public-community posts.
 * The ranking itself is viewer-independent and cached server-side; a wallet
 * connection is optional and only adds like/bookmark state.
 */
export default function TrendingFeedTab() {
  const mounted = useClientMounted()
  const { address } = useConnection()
  const router = useRouter()

  const [posts, setPosts] = useState({ list: [] })
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [isFetching, setIsFetching] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const [windowHours, setWindowHours] = useState(null)

  useEffect(() => {
    if (!mounted) return

    let cancelled = false

    getTrendingPosts(1, POSTS_PAGE_SIZE, null, address)
      .then((res) => {
        if (cancelled) return
        setPosts({ list: res?.data || [] })
        setHasMore(res?.meta?.hasMore || false)
        setWindowHours(res?.meta?.trending_window_hours ?? null)
        setPage(1)
      })
      .catch((error) => console.error('Trending feed error:', error))
      .finally(() => {
        if (!cancelled) setIsLoaded(true)
      })

    return () => {
      cancelled = true
    }
  }, [mounted, address])

  const loadMore = useCallback(async () => {
    if (isFetching || !hasMore) return
    setIsFetching(true)
    const nextPage = page + 1

    try {
      const res = await getTrendingPosts(nextPage, POSTS_PAGE_SIZE, null, address)
      if (res?.success && res.data.length > 0) {
        setPosts((prev) => ({ list: [...prev.list, ...res.data] }))
        setPage(nextPage)
      }
      setHasMore(res?.meta?.hasMore || false)
    } catch (error) {
      console.error('Trending feed load-more error:', error)
    } finally {
      setIsFetching(false)
    }
  }, [isFetching, hasMore, page, address])

  const handlePostClick = (item) => {
    router.push(`/networks/${item.network_id}/${item.id}`)
  }

  if (!mounted) return null

  if (isLoaded && posts.list.length === 0) {
    return <EmptyState message="Nothing is trending right now. Check back soon." />
  }

  return (
    <div className={clsx('__container')} data-width="small">
      {windowHours === WEEK_WINDOW_HOURS && (
        <p className={clsx('text-center', 'p-100')}>Quiet day — showing top posts from this week.</p>
      )}

      <div className={clsx('__container', styles.page__container)} data-width="medium">
        {posts.list.map((item, i) => (
          <section key={`${item.network_id}-${item.id}`} className={clsx(styles.post, 'animate', 'fade')} onClick={() => handlePostClick(item)}>
            <PostCard item={item} networkName={item.network_name} actions={['like', 'comment', 'share', 'repost', 'tip', 'view', 'quote', 'bookmark']} />
            {i < posts.list.length - 1 && <hr />}
          </section>
        ))}
      </div>

      {hasMore && (
        <div className="flex justify-content-center p-100">
          <button className={clsx(styles.loadMore)} onClick={loadMore} disabled={isFetching}>
            {isFetching ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}
    </div>
  )
}

const EmptyState = ({ message }) => (
  <div className={clsx('__container')} data-width="small">
    <p className={clsx('text-center', 'p-100')}>{message}</p>
  </div>
)

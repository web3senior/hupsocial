'use client'

import { Spinner } from '@/components/Loading'
import { useRouter } from 'next/navigation'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useConnection } from 'wagmi'
import clsx from 'clsx'
import { useBlockedUsers } from '@/hooks/useBlockedUsers'
import { getTrendingPosts } from '@/lib/api'
import { rememberCardPointerDown, isTextSelectionDrag } from '@/lib/cardClick'
import { useClientMounted } from '@/hooks/useClientMount'
import { useFeedTabCache } from '@/hooks/useFeedTabCache'
import { PostCard } from '@/components/Post'
import PostSkeletonGrid from '@/components/ui/PostSkeleton'
import FeedError from '@/components/ui/FeedError'
import { openPost } from '@/stores/usePostOverlayStore'
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
  const { isBlocked } = useBlockedUsers()
  const mounted = useClientMounted()
  const { address } = useConnection()
  const router = useRouter()

  // Switching tabs away and back restores the loaded posts and scroll place, like For you
  const { initialCache, remember, containerRef, containerStyle, cardStyle } = useFeedTabCache('trending', address)

  const [posts, setPosts] = useState(() => ({ list: initialCache?.list ?? [] }))
  const [page, setPage] = useState(initialCache?.page ?? 1)
  const [hasMore, setHasMore] = useState(initialCache?.hasMore ?? false)
  const [isFetching, setIsFetching] = useState(false)
  const [isLoaded, setIsLoaded] = useState(Boolean(initialCache))
  const [windowHours, setWindowHours] = useState(initialCache?.windowHours ?? null)
  const [loadError, setLoadError] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)
  // Viewer the shown rows were fetched for; the mount fetch is skipped while it still matches
  const appliedAddressRef = useRef(initialCache ? (address ?? null) : undefined)

  useEffect(() => {
    remember({ list: posts.list, page, hasMore, windowHours })
  })

  useEffect(() => {
    if (!mounted || appliedAddressRef.current === (address ?? null)) return

    let cancelled = false

    getTrendingPosts(1, POSTS_PAGE_SIZE, null, address)
      .then((res) => {
        if (cancelled) return
        setPosts({ list: res?.data || [] })
        setHasMore(res?.meta?.hasMore || false)
        setWindowHours(res?.meta?.trending_window_hours ?? null)
        setPage(1)
        setLoadError(false)
        appliedAddressRef.current = address ?? null
      })
      .catch((error) => {
        console.error('Trending feed error:', error)
        // Otherwise a failed load falls through to the "nothing is trending" copy.
        if (!cancelled) setLoadError(true)
      })
      .finally(() => {
        if (!cancelled) setIsLoaded(true)
      })

    return () => {
      cancelled = true
    }
  }, [mounted, address, retryNonce])

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
    openPost(item, router)
  }

  const visiblePosts = posts.list.filter((item) => !isBlocked(item.wallet_address) && !isBlocked(item.repost_original?.wallet_address))

  if (!mounted) return null

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

  if (isLoaded && visiblePosts.length === 0 && !hasMore) {
    return <EmptyState>Nothing is trending right now. Check back soon.</EmptyState>
  }

  return (
    <div className={clsx('__container')} data-width="small">
      {windowHours === WEEK_WINDOW_HOURS && (
        <p className={clsx('text-center', 'p-100')}>Quiet day — showing top posts from this week.</p>
      )}

      <div ref={containerRef} style={containerStyle} className={clsx('__container', styles.page__container)} data-width="medium">
        {visiblePosts.map((item, i) => (
          <section
            key={`${item.network_id}-${item.id}`}
            data-post-key={`${item.network_id}-${item.id}`}
            style={cardStyle(`${item.network_id}-${item.id}`)}
            className={clsx(styles.post, !initialCache && ['animate', 'fade'])}
            onPointerDown={rememberCardPointerDown}
            onClick={(e) => {
              if (isTextSelectionDrag(e)) return
              handlePostClick(item)
            }}
          >
            <PostCard item={item} networkName={item.network_name} actions={['like', 'comment', 'share', 'repost', 'tip', 'view', 'quote', 'bookmark']} />
            {i < visiblePosts.length - 1 && <hr />}
          </section>
        ))}
      </div>

      {hasMore && (
        <div className="flex justify-content-center p-100">
          <button className={clsx(styles.loadMore)} onClick={loadMore} disabled={isFetching}>
            {isFetching ? <><Spinner size={16} color="currentColor" /> Loading...</> : 'Load More'}
          </button>
        </div>
      )}
    </div>
  )
}

// Shared column chrome, so the skeleton, the retry card and the empty copy all land in the same
// place the posts would have.
const FeedPanel = ({ children }) => (
  <div className={clsx('__container')} data-width="small">
    <div className={clsx('__container', styles.page__container)} data-width="medium">
      {children}
    </div>
  </div>
)

const EmptyState = ({ message }) => (
  <FeedPanel>
    <p className={clsx('text-center', 'p-100')}>{message}</p>
  </FeedPanel>
)

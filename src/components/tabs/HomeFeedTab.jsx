'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useConnection } from 'wagmi'
import clsx from 'clsx'
import { getPosts } from '@/lib/api'
import { useClientMounted } from '@/hooks/useClientMount'
import { PostCard } from '@/components/Post'
import PageTitle from '@/components/PageTitle'
import styles from '@/app/page.module.scss'
import { usePostStore } from '@/stores/usePostStore'

// Must stay consistent across all getPosts() calls: the API's offset is (page - 1) * limit,
// so mixing page sizes shifts the offset and re-fetches an already-loaded window.
const POSTS_PAGE_SIZE = 20

/**
 * Renders a single feed of posts, either the unscoped "For you" feed or one
 * locked to a specific network (chainId). Extracted from app/page.jsx so it
 * can be mounted per-tab from HomeTabStrip's tab dispatch.
 *
 * Feed state (posts/pagination) is kept LOCAL to this instance rather than in
 * the shared usePostStore - multiple tabs (For you, several network tabs) can
 * exist at once, and a single global "hasInitialized" flag would make every
 * tab after the first skip fetching and show the wrong feed's posts.
 */
export default function HomeFeedTab({ feedMode = 'foryou', networkId = null, title = 'For you' }) {
  const setCurrentPost = usePostStore((state) => state.setCurrentPost)
  const feedRefreshNonce = usePostStore((state) => state.feedRefreshNonce)

  const [posts, setPosts] = useState({ list: [] })
  const [postsLoaded, setPostsLoaded] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [hasInitialized, setHasInitialized] = useState(false)
  const [isFetching, setIsFetching] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [page, setPage] = useState(1)
  const [newPostsQueue, setNewPostsQueue] = useState([])

  const mounted = useClientMounted()
  const { address } = useConnection()
  const router = useRouter()

  const isFetchingRef = useRef(false)
  const hasMoreRef = useRef(false)

  const scopedNetworkId = feedMode === 'network' ? networkId : null

  useEffect(() => {
    isFetchingRef.current = isFetching
    hasMoreRef.current = hasMore
  }, [isFetching, hasMore])

  useEffect(() => {
    const handleScroll = () => {
      const scrollElement = document.documentElement
      if (!scrollElement) return

      const { scrollTop, clientHeight, scrollHeight } = scrollElement
      const SCROLL_THRESHOLD = 300

      if (scrollTop + clientHeight >= scrollHeight - SCROLL_THRESHOLD) {
        if (hasMoreRef.current && !isFetchingRef.current) {
          loadMorePosts()
        }
      }
    }

    if (mounted) {
      window.addEventListener('scroll', handleScroll, { passive: true })
      return () => window.removeEventListener('scroll', handleScroll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted])

  const setInitialData = useCallback((postsResponse) => {
    const rawPosts = postsResponse?.data || []
    const seenIds = new Set()
    const initialPosts = rawPosts.filter((p) => {
      if (seenIds.has(p.id)) return false
      seenIds.add(p.id)
      return true
    })

    setPosts({ list: initialPosts })
    setPostsLoaded(initialPosts.length)
    setHasMore(postsResponse?.meta?.hasMore || false)
    setHasInitialized(true)
  }, [])

  const appendPosts = useCallback((postsResponse) => {
    const newPosts = postsResponse?.data || []
    setPosts((prev) => {
      const existingIds = new Set(prev.list.map((p) => p.id))
      const uniqueNewPosts = newPosts.filter((p) => !existingIds.has(p.id))
      setPostsLoaded((loaded) => loaded + uniqueNewPosts.length)
      return { list: [...prev.list, ...uniqueNewPosts] }
    })
    setHasMore(postsResponse?.meta?.hasMore || false)
  }, [])

  useEffect(() => {
    let cancelled = false

    const initializeData = async () => {
      if (isFetchingRef.current) return

      try {
        const postsRes = await getPosts(1, POSTS_PAGE_SIZE, scopedNetworkId, null, address)
        if (!cancelled) setInitialData(postsRes)
      } catch (error) {
        console.error('Initialization error:', error)
      }
    }

    if (mounted) initializeData()

    return () => {
      cancelled = true
    }
    // Re-initializes whenever this tab's scope changes (e.g. mounted fresh per tab switch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, address, scopedNetworkId])

  // Background polling for new posts
  useEffect(() => {
    if (!mounted || !hasInitialized) return

    const pollingInterval = setInterval(async () => {
      try {
        const latestKnownId = posts.list[0]?.id
        const response = await getPosts(1, POSTS_PAGE_SIZE, scopedNetworkId, null, address)

        if (response.success && response.data.length > 0) {
          const newItemsIndex = response.data.findIndex((item) => item.id === latestKnownId)

          if (newItemsIndex > 0) {
            setNewPostsQueue(response.data.slice(0, newItemsIndex))
          } else if (newItemsIndex === -1 && latestKnownId !== undefined) {
            setNewPostsQueue(response.data)
          }
        }
      } catch (error) {
        console.error('Polling error:', error)
      }
    }, 30000)

    return () => clearInterval(pollingInterval)
  }, [mounted, hasInitialized, posts.list, address, scopedNetworkId])

  const handlePostPrefetch = (item) => {
    router.prefetch(`/networks/${item.network_id}/${item.id}`)
  }

  const handlePostClick = (item) => {
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) return

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(200)
    }

    setCurrentPost(item)
    router.push(`networks/${item.network_id}/${item.id}`)
  }

  const loadMorePosts = useCallback(async () => {
    if (isFetchingRef.current || !hasMoreRef.current) return

    setIsFetching(true)
    const nextPage = page + 1

    try {
      const response = await getPosts(nextPage, POSTS_PAGE_SIZE, scopedNetworkId, null, address)

      if (response.success && response.data.length > 0) {
        appendPosts(response)
        setPage(nextPage)
      }
    } catch (error) {
      console.error('Error loading more posts:', error)
    } finally {
      setIsFetching(false)
    }
  }, [page, appendPosts, address, scopedNetworkId])

  const handleMergeNewPosts = useCallback(() => {
    if (newPostsQueue.length === 0) return

    setInitialData({ success: true, data: [...newPostsQueue, ...posts.list] })
    setNewPostsQueue([])

    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [newPostsQueue, posts.list, setInitialData])

  const handleManualRefresh = useCallback(async () => {
    if (newPostsQueue.length > 0) {
      handleMergeNewPosts()
      return
    }

    setIsRefreshing(true)
    setIsFetching(true)
    try {
      const postsRes = await getPosts(1, POSTS_PAGE_SIZE, scopedNetworkId, null, address)
      setInitialData(postsRes)
      setPage(1)
      setNewPostsQueue([])
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      console.error('Refresh error:', error)
    } finally {
      setIsFetching(false)
      setIsRefreshing(false)
    }
  }, [newPostsQueue, handleMergeNewPosts, address, scopedNetworkId, setInitialData])

  // Refresh requested from outside (Aside home link while already at top).
  // Nonce ref guard: only fire on an actual bump, not on callback identity changes.
  const lastRefreshNonceRef = useRef(feedRefreshNonce)
  useEffect(() => {
    if (feedRefreshNonce === lastRefreshNonceRef.current) return
    lastRefreshNonceRef.current = feedRefreshNonce
    handleManualRefresh()
  }, [feedRefreshNonce, handleManualRefresh])

  return (
    <div className={styles.page}>
      <div className={clsx(styles.page__header)}>
        <PageTitle name={title} changeDocumentTitle={false} />
      </div>

      <div className={clsx('__container')} data-width="small">
        {newPostsQueue.length > 0 && (
          <button className={clsx(styles['new-posts'])} onClick={handleMergeNewPosts}>
            Show {newPostsQueue.length} post{newPostsQueue.length > 1 ? 's' : ''}
          </button>
        )}

        <div className={clsx(styles.tabContent, styles.feedTab, 'relative')}>
          <div className={clsx(styles.page, 'motion-slideDownIn')}>
            <div className={clsx('__container', styles.page__container)} data-width="medium">
              {isRefreshing && (
              <div className={clsx(styles.refreshSpinnerWrap, 'animate fade')}>
                <svg
                  className={clsx(styles.refreshSpinner)}
                  width={24}
                  height={24}
                  xmlns="http://www.w3.org/2000/svg"
                  xmlnsXlink="http://www.w3.org/1999/xlink"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="xMidYMid"
                  style={{ background: 'none' }}
                >
                  {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((deg, i) => (
                    <g key={deg} transform={`rotate(${deg} 50 50)`}>
                      <rect x="45" y="0" rx="0" ry="0" width="10" height="30" fill="var(--color-icon-muted)">
                        <animate attributeName="opacity" values="1;0" dur="1s" begin={`${-(11 - i) / 12}s`} repeatCount="indefinite" />
                      </rect>
                    </g>
                  ))}
                </svg>
              </div>
            )}

            {postsLoaded === 0 && <PostSkeletonGrid count={14} />}

            {posts?.list?.map((item, i) => (
              <section
                key={item.id}
                className={clsx(styles.post, 'animate', 'fade')}
                onClick={(e) => {
                  e.stopPropagation()
                  handlePostClick(item)
                }}
                onMouseEnter={() => handlePostPrefetch(item)}
                onTouchStart={() => handlePostPrefetch(item)}
              >
                <PostCard item={item} networkName={item.network_name} actions={['like', 'comment', 'share', 'repost', 'view', 'quote', 'bookmark']} />
                {i < posts.list.length - 1 && <hr />}
              </section>
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-content-center p-100">
              <button
                className={clsx(styles.loadMore)}
                onClick={(e) => {
                  e.stopPropagation()
                  loadMorePosts()
                }}
                disabled={isFetching}
              >
                {isFetching ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  )
}

const PostSkeletonGrid = ({ count = 5 }) => (
  <div className={clsx('flex', 'flex-column', 'gap-2', 'mb-10')}>
    {Array.from({ length: count }).map((_, i) => (
      <PostShimmer key={i} />
    ))}
  </div>
)

const PostShimmer = () => (
  <div className={clsx(styles.pageShimmer)}>
    <div className={clsx('flex', 'flex-row', 'align-items-start', 'gap-1')}>
      <div className={clsx('shimmer', 'rounded')} style={{ width: `36px`, height: `36px` }} />
      <div className={clsx('flex', 'flex-column', 'gap-025', 'flex-1')}>
        <div className={clsx('shimmer', 'rounded')} style={{ width: `20%`, height: `12px` }} />
        <div className={clsx('shimmer', 'rounded')} style={{ width: `90%`, height: `12px` }} />
      </div>
    </div>
  </div>
)

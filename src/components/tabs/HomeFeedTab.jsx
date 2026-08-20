'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react'
import { useConnection } from 'wagmi'
import clsx from 'clsx'
import { getPosts } from '@/lib/api'
import { rememberCardPointerDown, isTextSelectionDrag } from '@/lib/cardClick'
import { useClientMounted } from '@/hooks/useClientMount'
import { PostCard } from '@/components/Post'
import { usePostStore } from '@/stores/usePostStore'
import { useFeedCacheStore } from '@/stores/useFeedCacheStore'
import PageTitle from '@/components/PageTitle'
import PostSkeletonGrid from '@/components/ui/PostSkeleton'
import FeedError from '@/components/ui/FeedError'
import styles from '@/app/page.module.scss'

// Must stay consistent across all getPosts() calls: the API's offset is (page - 1) * limit,
// so mixing page sizes shifts the offset and re-fetches an already-loaded window.
const POSTS_PAGE_SIZE = 20

// How far down the author can be and still have their freshly indexed post merged in place of
// being queued — roughly "hasn't really left the top of the feed yet".
const AUTHORED_MERGE_MAX_SCROLL_PX = 200

/**
 * Renders a single feed of posts: the unscoped "For you" feed, one locked to a
 * specific network (chainId), or the cross-network "premium" feed (posts with
 * an active HupBazaar listing — the bazaar page). Extracted from app/page.jsx so
 * it can be mounted per-tab from HomeTabStrip's tab dispatch.
 *
 * Feed state (posts/pagination) is kept LOCAL to this instance rather than in
 * the shared usePostStore - multiple tabs (For you, several network tabs) can
 * exist at once, and a single global "hasInitialized" flag would make every
 * tab after the first skip fetching and show the wrong feed's posts.
 */
export default function HomeFeedTab({
  feedMode = 'foryou',
  networkId = null,
  title = 'For you',
  changeDocumentTitle = false,
  // Section pages (bazaar) run wider so the feed lines up with their sibling tabs
  containerWidth = 'small',
}) {
  const setCurrentPost = usePostStore((state) => state.setCurrentPost)
  const feedRefreshNonce = usePostStore((state) => state.feedRefreshNonce)
  const authoredPostNonce = usePostStore((state) => state.authoredPostNonce)

  const mounted = useClientMounted()
  const { address } = useConnection()
  const router = useRouter()

  const scopedNetworkId = feedMode === 'network' ? networkId : null
  const feedType = feedMode === 'premium' ? 'premium' : feedMode === 'nft' ? 'nft' : null
  // Home-style feeds hide NFT-sale posts — those live in the dedicated NFTs tab.
  const excludeNft = feedMode === 'foryou' || feedMode === 'network'
  const feedCacheKey =
    feedMode === 'network' ? `network-${networkId}` : feedMode === 'premium' ? 'premium' : feedMode === 'nft' ? 'nft' : 'foryou'
  const saveFeedCache = useFeedCacheStore((state) => state.saveFeedCache)

  // Feed snapshot from an earlier visit this session, if any. Safe to read in
  // an initializer: the store is in-memory, so it's always empty during SSR
  // hydration, and cache hits only ever happen on client-side remounts.
  const [initialCache] = useState(() => useFeedCacheStore.getState().readFeedCache(feedCacheKey, address ?? null))

  const [posts, setPosts] = useState(() => ({ list: initialCache?.list ?? [] }))
  const [postsLoaded, setPostsLoaded] = useState(initialCache ? initialCache.list.length : 0)
  const [hasMore, setHasMore] = useState(initialCache?.hasMore ?? false)
  const [hasInitialized, setHasInitialized] = useState(Boolean(initialCache))
  const [isFetching, setIsFetching] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [page, setPage] = useState(initialCache?.page ?? 1)
  const [newPostsQueue, setNewPostsQueue] = useState([])
  // First page failed. Without it a dead request leaves the skeleton shimmering forever, since
  // client fetch() is outside the framework's offline retry.
  const [loadError, setLoadError] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)

  const isFetchingRef = useRef(false)
  const hasMoreRef = useRef(false)
  // Latest loadMorePosts, re-synced every render: the scroll listener below is
  // registered once (on mount), so calling the callback directly would freeze
  // its closure — `address` still undefined pre-wagmi-reconnect (appended pages
  // then fetch without viewer_address and lose is_liked) and `page` stuck at 1.
  const loadMorePostsRef = useRef(() => {})

  // Params of the feed data currently applied ("address|networkId"); the init
  // effect only fetches when they differ, so a cache hydration skips the mount
  // fetch while later address changes still refetch. Set on data application
  // (not fetch start) to stay correct under StrictMode's double-run.
  const appliedParamsRef = useRef(initialCache ? `${address ?? null}|${scopedNetworkId}` : null)
  // Last user scroll position, tracked live: reading window.scrollY inside the
  // unmount cleanup is too late — Next may have already reset scroll for the
  // incoming route by then.
  const lastScrollYRef = useRef(0)
  // Cached scroll position to restore; consumed once the posts render.
  const pendingScrollRestoreRef = useRef(initialCache ? initialCache.scrollY ?? 0 : null)
  const cacheSnapshotRef = useRef(null)
  // Feed container height, tracked live like the scroll position (the ref is
  // already null in the unmount cleanup where the snapshot is saved).
  const containerRef = useRef(null)
  const lastFeedHeightRef = useRef(initialCache?.feedHeight ?? 0)
  // Height reserved on the container while restoring from cache: media hasn't
  // loaded yet on the first frames, so without it the document is too short
  // for the scroll target — the browser clamps scrollTo and the page visibly
  // crawls down as images stream in instead of restoring in one jump.
  const [reservedHeight, setReservedHeight] = useState(initialCache ? initialCache.feedHeight ?? null : null)

  // Snapshot the cacheable state every render for the save-on-exit cleanup below.
  useEffect(() => {
    cacheSnapshotRef.current = { list: posts.list, page, hasMore, address: address ?? null }
    lastFeedHeightRef.current = containerRef.current?.offsetHeight || lastFeedHeightRef.current
  })

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

      lastScrollYRef.current = scrollTop
      // Media loads change the height without a re-render, so re-measure here too.
      lastFeedHeightRef.current = containerRef.current?.offsetHeight || lastFeedHeightRef.current

      if (scrollTop + clientHeight >= scrollHeight - SCROLL_THRESHOLD) {
        if (hasMoreRef.current && !isFetchingRef.current) {
          loadMorePostsRef.current()
        }
      }
    }

    if (mounted) {
      window.addEventListener('scroll', handleScroll, { passive: true })
      return () => window.removeEventListener('scroll', handleScroll)
    }
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

  // Snapshot this feed's state when it goes away — unmount (navigation to
  // another route, tab switch) or scope change (React reuses the instance when
  // jumping between two network tabs, so cleanup, not unmount, is the exit).
  useEffect(() => {
    return () => {
      const snapshot = cacheSnapshotRef.current
      if (!snapshot || snapshot.list.length === 0) return
      saveFeedCache(feedCacheKey, { ...snapshot, scrollY: lastScrollYRef.current, feedHeight: lastFeedHeightRef.current || null })
    }
  }, [feedCacheKey, saveFeedCache])

  // Restore the cached scroll position once the hydrated posts have rendered.
  // Reaching the target once is not enough to stop: Next's layout-router
  // scrolls the new segment to top AFTER this effect (parent layout effects
  // run after children's), and media loads can still clamp the position. So
  // keep re-asserting until the target survives two consecutive frames —
  // rAF callbacks fire before the pending paint, so a reset that lands
  // pre-paint gets corrected pre-paint and never shows. The pending ref is
  // only cleared on success/deadline, so a StrictMode remount restarts the
  // loop cleanly.
  useLayoutEffect(() => {
    const target = pendingScrollRestoreRef.current
    if (target === null || posts.list.length === 0) return

    const deadline = performance.now() + 1500
    let frame = 0
    let stableFrames = 0
    const apply = () => {
      if (Math.abs(window.scrollY - target) < 2) {
        stableFrames += 1
      } else {
        stableFrames = 0
        // 'instant' overrides the app's global scroll-behavior: smooth — a plain
        // scrollTo animates the restore, which IS the visible top-to-position crawl.
        window.scrollTo({ top: target, behavior: 'instant' })
      }
      if (stableFrames >= 2 || performance.now() > deadline) {
        pendingScrollRestoreRef.current = null
        return
      }
      frame = requestAnimationFrame(apply)
    }
    apply()

    return () => cancelAnimationFrame(frame)
  }, [posts])

  useEffect(() => {
    let cancelled = false
    const params = `${address ?? null}|${scopedNetworkId}`

    const initializeData = async () => {
      if (isFetchingRef.current) return

      try {
        const postsRes = await getPosts(1, POSTS_PAGE_SIZE, scopedNetworkId, null, address, null, feedType, excludeNft)
        if (!cancelled) {
          setInitialData(postsRes)
          setLoadError(false)
          appliedParamsRef.current = params
        }
      } catch (error) {
        console.error('Initialization error:', error)
        // appliedParamsRef stays unset, so a retryNonce bump re-runs this effect and refetches.
        if (!cancelled) setLoadError(true)
      }
    }

    // Skip when data for these params is already applied — either hydrated
    // from the session cache (posts + scroll position restored, so no page-1
    // refetch behind a shimmer; the 30s polling below surfaces anything new)
    // or fetched by a previous run of this effect.
    if (mounted && appliedParamsRef.current !== params) {
      initializeData()
    }

    return () => {
      cancelled = true
    }
    // Re-initializes whenever this tab's scope changes (e.g. mounted fresh per tab switch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, address, scopedNetworkId, retryNonce])

  // Clearing the error first swaps the retry card back to the skeleton, so a retry looks like
  // the original load rather than a frozen button.
  const handleRetry = useCallback(() => {
    setLoadError(false)
    setRetryNonce((nonce) => nonce + 1)
  }, [])

  // Fetches page 1 and parks anything newer than the top card behind the "Show N posts" pill,
  // leaving the reader's scroll position untouched. Shared by the 30s background poll and the
  // nonce below, which needs the same non-intrusive pull on demand.
  const pollNewPosts = useCallback(async () => {
    try {
      const latestKnownId = posts.list[0]?.id
      const response = await getPosts(1, POSTS_PAGE_SIZE, scopedNetworkId, null, address, null, feedType, excludeNft)

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
  }, [posts.list, address, scopedNetworkId, feedType, excludeNft])

  // Background polling for new posts
  useEffect(() => {
    if (!mounted || !hasInitialized) return

    const pollingInterval = setInterval(pollNewPosts, 30000)

    return () => clearInterval(pollingInterval)
  }, [mounted, hasInitialized, pollNewPosts])

  const handlePostPrefetch = (item) => {
    router.prefetch(`/networks/${item.network_id}/${item.id}`)
  }

  const handlePostClick = (item) => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(200)
    }

    setCurrentPost(item)
    router.push(`/networks/${item.network_id}/${item.id}`)
  }

  const loadMorePosts = useCallback(async () => {
    if (isFetchingRef.current || !hasMoreRef.current) return

    setIsFetching(true)
    const nextPage = page + 1

    try {
      const response = await getPosts(nextPage, POSTS_PAGE_SIZE, scopedNetworkId, null, address, null, feedType, excludeNft)

      if (response.success && response.data.length > 0) {
        appendPosts(response)
        setPage(nextPage)
      }
    } catch (error) {
      console.error('Error loading more posts:', error)
    } finally {
      setIsFetching(false)
    }
  }, [page, appendPosts, address, scopedNetworkId, feedType, excludeNft])

  useEffect(() => {
    loadMorePostsRef.current = loadMorePosts
  }, [loadMorePosts])

  const handleMergeNewPosts = useCallback(() => {
    if (newPostsQueue.length === 0) return

    setInitialData({ success: true, data: [...newPostsQueue, ...posts.list] })
    setNewPostsQueue([])
    setReservedHeight(null)

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
      const postsRes = await getPosts(1, POSTS_PAGE_SIZE, scopedNetworkId, null, address, null, feedType, excludeNft)
      setInitialData(postsRes)
      setPage(1)
      setNewPostsQueue([])
      setReservedHeight(null)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      console.error('Refresh error:', error)
    } finally {
      setIsFetching(false)
      setIsRefreshing(false)
    }
  }, [newPostsQueue, handleMergeNewPosts, address, scopedNetworkId, feedType, excludeNft, setInitialData])

  // Refresh requested from outside (Aside home link while already at top).
  // Nonce ref guard: only fire on an actual bump, not on callback identity changes.
  const lastRefreshNonceRef = useRef(feedRefreshNonce)
  useEffect(() => {
    if (feedRefreshNonce === lastRefreshNonceRef.current) return
    lastRefreshNonceRef.current = feedRefreshNonce
    handleManualRefresh()
  }, [feedRefreshNonce, handleManualRefresh])

  // The viewer's own post just finished indexing (lib/postPublishToast.js). Merge it straight in
  // while they are still parked at the top — that is the whole point of the wait — but if they
  // have scrolled away in the meantime, queue it behind the pill instead of snatching the page.
  const handleAuthoredPost = useCallback(async () => {
    if (window.scrollY <= AUTHORED_MERGE_MAX_SCROLL_PX) await handleManualRefresh()
    else await pollNewPosts()
  }, [handleManualRefresh, pollNewPosts])

  const lastAuthoredNonceRef = useRef(authoredPostNonce)
  useEffect(() => {
    if (authoredPostNonce === lastAuthoredNonceRef.current) return
    lastAuthoredNonceRef.current = authoredPostNonce
    handleAuthoredPost()
  }, [authoredPostNonce, handleAuthoredPost])

  return (
    <div className={styles.page} ref={containerRef} style={reservedHeight ? { minHeight: reservedHeight } : undefined}>
      <PageTitle name={title} changeDocumentTitle={changeDocumentTitle} spacer={false} showInHeader={false} />

      <div className={clsx('__container')} data-width={containerWidth}>
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

            {postsLoaded === 0 && (loadError ? <FeedError onRetry={handleRetry} /> : <PostSkeletonGrid count={14} />)}

            {posts?.list?.map((item, i) => (
              <section
                key={item.id}
                // Restored feeds must repaint identically in place — no entrance replay.
                className={clsx(styles.post, !initialCache && ['animate', 'fade'])}
                onPointerDown={rememberCardPointerDown}
                onClick={(e) => {
                  e.stopPropagation()
                  if (isTextSelectionDrag(e)) return
                  handlePostClick(item)
                }}
                onMouseEnter={() => handlePostPrefetch(item)}
                onTouchStart={() => handlePostPrefetch(item)}
              >
                <PostCard item={item} networkName={item.network_name} actions={['like', 'comment', 'share', 'repost', 'tip', 'view', 'quote', 'bookmark']} />
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

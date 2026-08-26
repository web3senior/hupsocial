'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react'
import { useConnection } from 'wagmi'
import { isSolanaNetworkId } from '@/config/solana'
import { useSolanaWallet } from '@/hooks/useSolanaWallet'
import clsx from 'clsx'
import { getPosts } from '@/lib/api'
import { rememberCardPointerDown, isTextSelectionDrag } from '@/lib/cardClick'
import { useClientMounted } from '@/hooks/useClientMount'
import { PostCard } from '@/components/Post'
import PendingPost from '@/components/PendingPost'
import { usePostStore } from '@/stores/usePostStore'
import { usePendingPostStore } from '@/stores/usePendingPostStore'
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

// Post ids are per network — every chain's HupCommunity numbers its own posts from 1 — so a
// cross-network feed routinely holds two different posts with the same id. Identity is the pair.
const postKey = (post) => `${post.network_id}:${post.id}`

// First occurrence wins, so callers put the copy they want to keep first.
const dedupePosts = (list) => {
  const seen = new Set()
  return list.filter((post) => {
    const key = postKey(post)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

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
  const pendingPosts = usePendingPostStore((state) => state.pending)

  const mounted = useClientMounted()
  const { address: evmAddress } = useConnection()
  const solanaWallet = useSolanaWallet()
  const router = useRouter()

  const scopedNetworkId = feedMode === 'network' ? networkId : null
  // The viewer of a Solana feed is the Solana wallet — has_liked and the basket key off it
  const address = isSolanaNetworkId(scopedNetworkId) ? solanaWallet.address : evmAddress
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
  // The list as committed, readable from async callbacks. A poll response is diffed against
  // this at the moment it lands, so a merge or refresh that happened while the request was in
  // flight is already accounted for — otherwise those posts come straight back behind the pill.
  const postsListRef = useRef(initialCache?.list ?? [])
  // Page 1 as the latest poll saw it; the merge restarts from it when it no longer overlaps the
  // list at all (more arrived than a page holds), instead of prepending across a hole.
  const pendingPageRef = useRef(null)
  // Polls can overtake each other on a slow gateway; only the newest response may speak.
  const pollSeqRef = useRef(0)

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

  // Every list write goes through here so the ref never lags the state.
  const commitPosts = useCallback((list) => {
    postsListRef.current = list
    setPosts({ list })
  }, [])

  const setInitialData = useCallback(
    (postsResponse) => {
      const initialPosts = dedupePosts(postsResponse?.data || [])

      commitPosts(initialPosts)
      setPostsLoaded(initialPosts.length)
      setHasMore(postsResponse?.meta?.hasMore || false)
      setHasInitialized(true)
    },
    [commitPosts],
  )

  const appendPosts = useCallback(
    (postsResponse) => {
      const current = postsListRef.current
      const existing = new Set(current.map(postKey))
      const uniqueNewPosts = (postsResponse?.data || []).filter((post) => !existing.has(postKey(post)))

      commitPosts([...current, ...uniqueNewPosts])
      setPostsLoaded((loaded) => loaded + uniqueNewPosts.length)
      setHasMore(postsResponse?.meta?.hasMore || false)
    },
    [commitPosts],
  )

  // Pill merge: newer posts go on top and the pagination below stays exactly as it was —
  // routing this through setInitialData reset hasMore and killed infinite scroll.
  const prependPosts = useCallback(
    (newPosts) => {
      const current = postsListRef.current
      const existing = new Set(current.map(postKey))
      const uniqueNewPosts = newPosts.filter((post) => !existing.has(postKey(post)))
      if (uniqueNewPosts.length === 0) return

      commitPosts([...uniqueNewPosts, ...current])
      setPostsLoaded((loaded) => loaded + uniqueNewPosts.length)
    },
    [commitPosts],
  )

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

  // Fetches page 1 and parks whatever the feed doesn't hold yet behind the "Show N posts" pill,
  // leaving the reader's scroll position untouched. Shared by the 30s background poll and the
  // nonce below, which needs the same non-intrusive pull on demand.
  //
  // "New" is a set difference against the list as it stands when the response lands — not an
  // index hunt for a top-card id captured when the request left. The id hunt broke two ways: a
  // same-id post on another chain matched in its place, and a merge or refresh landing mid-flight
  // left the snapshot stale, so the posts just shown were queued a second time.
  const pollNewPosts = useCallback(async () => {
    const seq = ++pollSeqRef.current

    try {
      const response = await getPosts(1, POSTS_PAGE_SIZE, scopedNetworkId, null, address, null, feedType, excludeNft)
      if (seq !== pollSeqRef.current || !response.success) return

      const known = new Set(postsListRef.current.map(postKey))
      const fresh = dedupePosts(response.data).filter((post) => !known.has(postKey(post)))

      pendingPageRef.current = { data: response.data, hasMore: Boolean(response.meta?.hasMore) }
      // Keep the same empty array between quiet polls so the feed doesn't re-render every 30s.
      setNewPostsQueue((prev) => (prev.length === 0 && fresh.length === 0 ? prev : fresh))
    } catch (error) {
      console.error('Polling error:', error)
    }
  }, [address, scopedNetworkId, feedType, excludeNft])

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

    const pending = pendingPageRef.current
    const pageKeys = new Set((pending?.data ?? []).map(postKey))
    const overlaps = postsListRef.current.some((post) => pageKeys.has(postKey(post)))

    if (pending && !overlaps) {
      // More arrived than one page holds: prepending would leave a hole between the two, so
      // the feed restarts from the server's page 1 the way a refresh does.
      setInitialData({ success: true, data: pending.data, meta: { hasMore: pending.hasMore } })
      setPage(1)
    } else {
      prependPosts(newPostsQueue)
    }

    setNewPostsQueue([])
    setReservedHeight(null)

    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [newPostsQueue, prependPosts, setInitialData])

  // Always a real page-1 fetch. Draining the pill instead used to hand the author a queue that
  // was polled before their post existed, so the post itself surfaced one poll later — behind
  // a second pill.
  const handleManualRefresh = useCallback(async () => {
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
  }, [address, scopedNetworkId, feedType, excludeNft, setInitialData])

  // Refresh requested from outside (Aside home link while already at top).
  // Nonce ref guard: only fire on an actual bump, not on callback identity changes.
  const lastRefreshNonceRef = useRef(feedRefreshNonce)
  useEffect(() => {
    if (feedRefreshNonce === lastRefreshNonceRef.current) return
    lastRefreshNonceRef.current = feedRefreshNonce
    handleManualRefresh()
  }, [feedRefreshNonce, handleManualRefresh])

  // The viewer's own post just finished indexing (lib/postPublication.js). Merge it straight in
  // while they are still parked at the top — that is the whole point of the wait — but if they
  // have scrolled away in the meantime, queue it behind the pill instead of snatching the page.
  const handleAuthoredPost = useCallback(async () => {
    if (window.scrollY <= AUTHORED_MERGE_MAX_SCROLL_PX) await handleManualRefresh()
    else await pollNewPosts()
  }, [handleManualRefresh, pollNewPosts])

  // The viewer's own posts still in flight, drawn above the list as ghost cards. A ghost stops
  // being drawn the moment the row it resolved to is actually in this feed — that is the handover,
  // and doing it per feed means a tab that has not refreshed yet keeps its ghost instead of
  // blanking because some other tab got there first.
  const ghostPosts = useMemo(() => {
    if (pendingPosts.length === 0) return []
    // Only feeds a plain new post belongs in: the bazaar and NFT tabs list posts by what they
    // carry, which nothing can know before the post is indexed.
    if (feedMode !== 'foryou' && feedMode !== 'network') return []

    const listedKeys = new Set((posts?.list ?? []).map(postKey))
    return pendingPosts.filter((entry) => {
      if (feedMode === 'network' && Number(entry.networkId) !== Number(networkId)) return false
      return !(entry.resolvedKey && listedKeys.has(entry.resolvedKey))
    })
  }, [pendingPosts, posts.list, feedMode, networkId])

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

            {ghostPosts.map((entry) => (
              <section key={entry.id} className={styles.post}>
                <PendingPost entry={entry} />
                {posts?.list?.length > 0 && <hr />}
              </section>
            ))}

            {postsLoaded === 0 && (loadError ? <FeedError onRetry={handleRetry} /> : <PostSkeletonGrid count={14} />)}

            {posts?.list?.map((item, i) => (
              <section
                key={postKey(item)}
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

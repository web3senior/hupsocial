'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect, lazy, Suspense, useCallback, useRef } from 'react'
import { useConnection } from 'wagmi'
import clsx from 'clsx'
import { getApps, getPosts } from '@/lib/api'
import { useClientMounted } from '@/hooks/useClientMount'
import { getActiveChain } from '@/lib/communication'
import Post from '@/components/Post'
import PageTitle from '@/components/PageTitle'
import styles from './page.module.scss'
import { usePostStore } from '@/stores/usePostStore'
import { ContentSpinner } from '@/components/Loading'

const PollsTab = lazy(() => import('@/components/tabs/PollsTab'))
const CommunitiesTab = lazy(() => import('@/components/tabs/CommunitiesTab'))

export default function Page() {
  // ■■■ STATE & STORE ■■■
  const { posts, postsLoaded, hasMore, hasInitialized, TABS_DATA, setInitialData, appendPosts } = usePostStore()

  const [isFetching, setIsFetching] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState('posts')
  const [page, setPage] = useState(1)
  const [newPostsQueue, setNewPostsQueue] = useState([])

  // ■■■ HOOKS & REFS ■■■
  const mounted = useClientMounted()
  const activeChain = getActiveChain()
  const { address } = useConnection()
  const router = useRouter()

  const isFetchingRef = useRef(false)
  const hasMoreRef = useRef(false)

  // ■■■ DERIVED STATE ■■■
  const TabContentMap = {
    polls: PollsTab,
    apps: <></>,
    communities: CommunitiesTab,
  }
  const ActiveComponent = TabContentMap[activeTab]

  // ■■■ EFFECTS ■■■
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
        if (hasMoreRef.current && !isFetchingRef.current && activeTab === 'posts') {
          loadMorePosts()
        }
      }
    }

    if (mounted) {
      window.addEventListener('scroll', handleScroll)
      return () => window.removeEventListener('scroll', handleScroll)
    }
  }, [mounted, activeTab])

  useEffect(() => {
    const initializeData = async () => {
      if (hasInitialized || isFetchingRef.current) return

      try {
        const postsRes = await getPosts(1, 10, null, null, address)
        setInitialData([], postsRes)
      } catch (error) {
        console.error('Initialization error:', error)
      }
    }

    if (mounted) initializeData()
  }, [mounted, hasInitialized, activeChain, address, setInitialData])

  // Background polling for new posts
  useEffect(() => {
    if (!mounted || !posts?.list?.length) return

    const pollingInterval = setInterval(async () => {
      try {
        const latestKnownId = posts.list[0].id
        const response = await getPosts(1, 20, null, null, address)

        if (response.success && response.data.length > 0) {
          const newItemsIndex = response.data.findIndex((item) => item.id === latestKnownId)

          if (newItemsIndex > 0) {
            setNewPostsQueue(response.data.slice(0, newItemsIndex))
          } else if (newItemsIndex === -1) {
            setNewPostsQueue(response.data)
          }
        }
      } catch (error) {
        console.error('Polling error:', error)
      }
    }, 30000)

    return () => clearInterval(pollingInterval)
  }, [mounted, posts?.list, address])

  // ■■■ HANDLERS ■■■
  const handlePostClick = (postId, chainId) => {
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) return

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(200)
    }

    router.push(`networks/${chainId}/${postId}`)
  }

  const loadMorePosts = useCallback(async () => {
    if (isFetchingRef.current || !hasMoreRef.current) return

    setIsFetching(true)
    const nextPage = page + 1

    try {
      const response = await getPosts(nextPage, 10)

      if (response.success && response.data.length > 0) {
        appendPosts(response)
        setPage(nextPage)
      }
    } catch (error) {
      console.error('Error loading more posts:', error)
    } finally {
      setIsFetching(false)
    }
  }, [page, appendPosts])

  const handleMergeNewPosts = useCallback(() => {
    if (newPostsQueue.length === 0) return

    // ■■■ RECONSTRUCT RAW API FORMAT ■■■
    // setInitialData expects the exact structure returned by getPosts()
    const mergedResponse = {
      success: true,
      data: [...newPostsQueue, ...(posts?.list || [])],
    }

    setInitialData([], mergedResponse)
    setNewPostsQueue([])

    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [newPostsQueue, posts?.list, setInitialData])

const handleManualRefresh = useCallback(async () => {
  if (newPostsQueue.length > 0) {
    handleMergeNewPosts()
    return
  }

  setIsRefreshing(true)
  setIsFetching(true)
  try {
    const postsRes = await getPosts(1, 10, null, null, address)
    setInitialData([], postsRes)
    setPage(1)
    setNewPostsQueue([])
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } catch (error) {
    console.error('Refresh error:', error)
  } finally {
    setIsFetching(false)
    setIsRefreshing(false) // Turn off refresh loading
  }
}, [newPostsQueue, handleMergeNewPosts, address, setInitialData])

  return (
    <>
      <div onClick={handleManualRefresh} className={clsx(styles.page__header)} role="button" tabIndex={0}>
        <PageTitle name={`Onchain`} changeDocumentTitle={false} />
      </div>

<div className={clsx('__container')} data-width={`small`}>
  {newPostsQueue.length > 0 && (
    <button className={clsx(styles['new-posts'])} onClick={handleMergeNewPosts}>
      Show {newPostsQueue.length} post{newPostsQueue.length > 1 ? 's' : ''}
    </button>
  )}

  <div className={clsx(styles.tabContent, styles.feedTab, 'relative')}>
    <div className={clsx(styles.page, 'motion-slideDownIn')}>
      <div className={clsx('__container', styles.page__container)} data-width={`medium`}>
        
        {/* 1. Inline Top Loader (Shown while preserving existing posts) */}
        {isRefreshing && (
          <div className="flex justify-content-center w-full p-20 animate fade">
            <ContentSpinner /> 
          </div>
        )}

        {/* 2. Skeleton fallback for initial blank state only */}
        {postsLoaded === 0 && <PostSkeletonGrid count={10} />}

        {/* 3. Render feed posts */}
        {posts?.list?.map((item, i) => (
          <section
            key={item.id}
            className={clsx(styles.post, 'animate', 'fade')}
            onClick={() => handlePostClick(item.id, item.network_id)}
          >
            <Post
              item={item}
              networkName={item.network_name}
              actions={['like', 'comment', 'share', 'repost', 'view', 'quote', 'hash']}
              showLastComment={true}
            />
            {i < posts.list.length - 1 && <hr />}
          </section>
        ))}
      </div>

      {hasMore && (
        <div className="flex justify-content-center p-100">
          <button className={clsx(styles.loadMore)} onClick={loadMorePosts} disabled={isFetching}>
            {isFetching ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}
    </div>
  </div>
</div>
    </>
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

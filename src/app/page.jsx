'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect, lazy, Suspense, useCallback, useRef } from 'react'
import { useConnection } from 'wagmi'
import { getApps, getPosts } from '@/lib/api'
import Profile from '@/components/Profile'
import { useClientMounted } from '@/hooks/useClientMount'
import { getActiveChain } from '@/lib/communication'
import Post from '@/components/Post'
import PageTitle from '@/components/PageTitle'
import styles from './page.module.scss'
import { usePostStore } from '@/store/usePostStore'

const PollsTab = lazy(() => import('@/components/tabs/PollsTab'))
const EventsTab = lazy(() => import('@/components/tabs/EventsTab'))
const AppsTab = lazy(() => import('@/components/tabs/AppsTab'))
const CommunitiesTab = lazy(() => import('@/components/tabs/CommunitiesTab'))

export default function Page() {
  const { 
    posts, 
    postsLoaded, 
    hasMore, 
    hasInitialized, 
    TABS_DATA, 
    setInitialData, 
    appendPosts 
  } = usePostStore()
  
  const [isFetching, setIsFetching] = useState(false)
  const [activeTab, setActiveTab] = useState('posts')
  const [page, setPage] = useState(1)
  
  const mounted = useClientMounted()
  const activeChain = getActiveChain()
  const { address } = useConnection()
  const router = useRouter()

  const TabContentMap = {
    polls: PollsTab,
    events: EventsTab,
    apps: AppsTab,
    communities: CommunitiesTab,
  }
  const ActiveComponent = TabContentMap[activeTab]

  const isFetchingRef = useRef(false)
  const hasMoreRef = useRef(false)

  useEffect(() => {
    isFetchingRef.current = isFetching
    hasMoreRef.current = hasMore
  }, [isFetching, hasMore])

  const handlePostClick = (postId, chainId) => {
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) return
    
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(200)
    }

    router.push(`chain/${chainId}/${postId}`)
  }

  const loadMorePosts = useCallback(async () => {
    if (isFetchingRef.current || !hasMoreRef.current) return

    setIsFetching(true)
    const nextPage = page + 1

    try {
      // Use the chain_id from the active chain for filtering
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
  }, [page, activeChain, appendPosts])

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
  }, [mounted, loadMorePosts, activeTab])

  useEffect(() => {
    const initializeData = async () => {
      if (hasInitialized || isFetchingRef.current) return

      try {
        const appsRes = await getApps(activeChain[0].id)
        const postsRes = await getPosts(1, 10)//, activeChain[0].id
        setInitialData(appsRes, postsRes)
      } catch (error) {
        console.error('Initialization error:', error)
      }
    }

    if (mounted) initializeData()
  }, [mounted, hasInitialized, activeChain, setInitialData])

  return (
    <>
      <PageTitle name={`Onchain Feed`} />
      <div className={`__container`} data-width={`medium`}>

        {/* <Suspense fallback={<div>Loading Tab Content...</div>}>
          {ActiveComponent && <ActiveComponent />}
        </Suspense> */}

          <div className={`${styles.tabContent} ${styles.feedTab} relative`}>
            <div className={`${styles.page} motion-slideDownIn`}>
              <div className={`__container ${styles.page__container}`} data-width={`medium`}>
                {postsLoaded === 0 && <PostSkeletonGrid count={10} />}

                <div className={`${styles.grid} flex flex-column`}>
                  {posts?.list?.map((item, i) => (
                    <section
                      key={item.id} 
                      className={`${styles.post} animate fade`}
                      onClick={() => handlePostClick(item.id, item.chain_id)}
                    >
                      <Post 
                        item={item} 
                        networkName={item.network_name}
                        actions={['like', 'comment', 'share', 'repost', 'hash', 'tip']} 
                      />
                      {i < posts.list.length - 1 && <hr />}
                    </section>
                  ))}
                </div>
              </div>

              {hasMore && (
                <div className="flex justify-content-center p-100">
                  <button 
                    className={`${styles.loadMore}`} 
                    onClick={loadMorePosts}
                    disabled={isFetching}
                  >
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
  <div className={`flex flex-column gap-2 mb-10`}>
    {Array.from({ length: count }).map((_, i) => (
      <PostShimmer key={i} />
    ))}
  </div>
)

const PostShimmer = () => (
  <div className={`${styles.pageShimmer}`}>
    <div className={`flex flex-row align-items-start gap-1`}>
      <div className={`shimmer rounded`} style={{ width: `36px`, height: `36px` }} />
      <div className={`flex flex-column gap-025 flex-1`}>
        <div className={`shimmer rounded`} style={{ width: `20%`, height: `12px` }} />
        <div className={`shimmer rounded`} style={{ width: `90%`, height: `12px` }} />
      </div>
    </div>
  </div>
)
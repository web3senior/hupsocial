'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect, useCallback } from 'react'
import { useConnection } from 'wagmi'
import clsx from 'clsx'
import { getFollowingPosts } from '@/lib/api'
import { getActiveChain } from '@/lib/communication'
import { useClientMounted } from '@/hooks/useClientMount'
import { PostCard } from '@/components/Post'
import styles from '@/app/page.module.scss'

const POSTS_PAGE_SIZE = 20

/**
 * Feed of posts from wallets the connected address follows, scoped to the
 * currently active network (getFollowingAddresses only supports one chain at
 * a time - see src/lib/followSystem.js).
 */
export default function FollowingFeedTab() {
  const mounted = useClientMounted()
  const { address, isConnected } = useConnection()
  const router = useRouter()
  const [activeChain] = getActiveChain()

  const [posts, setPosts] = useState({ list: [] })
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [isFetching, setIsFetching] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const [followingSupported, setFollowingSupported] = useState(true)

  useEffect(() => {
    if (!mounted || !isConnected || !address || !activeChain) return

    let cancelled = false

    getFollowingPosts(activeChain.id, address, 1, POSTS_PAGE_SIZE)
      .then((res) => {
        if (cancelled) return
        setPosts({ list: res?.data || [] })
        setHasMore(res?.meta?.hasMore || false)
        setFollowingSupported(res?.meta?.followingSupported !== false)
        setPage(1)
      })
      .catch((error) => console.error('Following feed error:', error))
      .finally(() => {
        if (!cancelled) setIsLoaded(true)
      })

    return () => {
      cancelled = true
    }
  }, [mounted, isConnected, address, activeChain?.id])

  const loadMore = useCallback(async () => {
    if (isFetching || !hasMore || !activeChain) return
    setIsFetching(true)
    const nextPage = page + 1

    try {
      const res = await getFollowingPosts(activeChain.id, address, nextPage, POSTS_PAGE_SIZE)
      if (res?.success && res.data.length > 0) {
        setPosts((prev) => ({ list: [...prev.list, ...res.data] }))
        setPage(nextPage)
      }
      setHasMore(res?.meta?.hasMore || false)
    } catch (error) {
      console.error('Following feed load-more error:', error)
    } finally {
      setIsFetching(false)
    }
  }, [isFetching, hasMore, page, activeChain, address])

  const handlePostClick = (item) => {
    router.push(`/networks/${item.network_id}/${item.id}`)
  }

  if (!mounted) return null

  if (!isConnected) {
    return <EmptyState message="Connect your wallet to see posts from people you follow." />
  }

  if (isLoaded && !followingSupported) {
    return <EmptyState message={`Following isn't available on ${activeChain?.name ?? 'this network'} yet. Try switching networks.`} />
  }

  if (isLoaded && posts.list.length === 0) {
    return <EmptyState message="No posts yet from wallets you follow." />
  }

  return (
    <div className={clsx('__container')} data-width="small">
      <div className={clsx('__container', styles.page__container)} data-width="medium">
        {posts.list.map((item, i) => (
          <section key={item.id} className={clsx(styles.post, 'animate', 'fade')} onClick={() => handlePostClick(item)}>
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

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Heart,
  LucideLoader2,
  LucideRefreshCcw,
  ExternalLink,
  Clock,
  User,
} from 'lucide-react'
import { useConnection } from 'wagmi'
import Profile from '@/components/Profile'
import { toRelativeTime } from '@/lib/dateHelper'
import { getPostById } from '@/lib/api'
import styles from './LikedPosts.module.scss'

const PAGE_SIZE = 20

export default function LikedPosts() {
  const { address, isConnected } = useConnection()
  const [items, setItems] = useState([])
  const [nextPage, setNextPage] = useState(null)
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)

  const loadLikedPosts = useCallback(
    async ({ page = 1, append = false, signal } = {}) => {
      if (!address) return

      setIsLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({
          wallet_address: address,
          page: String(page),
          limit: String(PAGE_SIZE),
        })

        const response = await fetch(`/api/v1/networks/posts/liked?${params}`, { signal })
        const payload = await response.json()

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || 'Failed to fetch liked posts')
        }

        setItems((current) => (append ? [...current, ...payload.data] : payload.data))
        setNextPage(payload.nextPage)
        setTotalCount(payload.meta?.total_count || 0)
      } catch (err) {
        if (err.name === 'AbortError') return
        console.error('Liked posts fetch error:', err)
        setError('Could not load liked posts.')
      } finally {
        if (!signal?.aborted) setIsLoading(false)
      }
    },
    [address],
  )

  useEffect(() => {
    if (!isConnected || !address) return

    const controller = new AbortController()
    const timer = setTimeout(() => {
      loadLikedPosts({ signal: controller.signal })
    }, 0)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [address, isConnected, loadLikedPosts])

  const visibleItems = useMemo(
    () =>
      isConnected && address
        ? items.filter(
            (item) => item.actor_wallet_address?.toLowerCase() === address.toLowerCase(),
          )
        : [],
    [address, isConnected, items],
  )

  const hasItems = visibleItems.length > 0
  const activeNextPage = hasItems ? nextPage : null

  const headerLabel = useMemo(() => {
    if (!hasItems) return 'Liked Posts'
    return `${totalCount} liked posts`
  }, [hasItems, totalCount])

  if (!isConnected) {
    return (
      <div className={styles.container}>
        <div className={styles.status}>
          <User size={20} />
          Please connect your wallet to view liked posts.
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h4>
          <Heart size={18} fill="currentColor" />
          {headerLabel}
        </h4>
        <button
          type="button"
          onClick={() => loadLikedPosts()}
          className={styles.refreshButton}
          disabled={isLoading}
          aria-label="Refresh liked posts"
          title="Refresh liked posts"
        >
          <LucideRefreshCcw className={isLoading ? styles.spin : undefined} size={16} />
        </button>
      </div>

      <div className={styles.feed}>
        {!hasItems && isLoading ? (
          <div className={styles.status}>
            <LucideLoader2 className={styles.spin} size={16} />
            Loading liked items...
          </div>
        ) : null}

        {!hasItems && !isLoading ? (
          <div className={styles.status}>
            <Heart size={18} />
            No liked posts found.
          </div>
        ) : null}

        {visibleItems.map((item) => (
          <LikedPostRow 
            key={item.id} 
            item={item} 
            currentAddress={address} 
          />
        ))}
      </div>

      <div className={styles.footer}>
        {activeNextPage ? (
          <button
            type="button"
            onClick={() => loadLikedPosts({ page: activeNextPage, append: true })}
            disabled={isLoading}
            className={styles.loadMore}
          >
            {isLoading ? (
              <>
                <LucideLoader2 className={styles.spin} size={16} />
                Loading...
              </>
            ) : (
              'Load more'
            )}
          </button>
        ) : (
          hasItems && (
            <div className={styles.status}>
              <Clock size={14} />
              End of list
            </div>
          )
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}

function LikedPostRow({ item, currentAddress }) {
  const targetAuthor = item.recipient_wallet_address
  const href = getPostHref(item)

  const [post, setPost] = useState(null)
  const [isLoadingPost, setIsLoadingPost] = useState(false)

  const entityId = item.data?.parent_post_id || item.entity_id || item.data?.post_id
  const networkId = item.network_id || item.data?.network_id

  useEffect(() => {
    if (!networkId || !entityId) return

    let cancelled = false
    setIsLoadingPost(true)

    getPostById(networkId, entityId, currentAddress)
      .then((res) => {
        if (cancelled) return

        const fetchedPost = Array.isArray(res?.data) ? res.data[0] : res?.data
        setPost(fetchedPost || null)
      })
      .catch((err) => {
        console.error('Error fetching liked post raw content:', err)
        if (!cancelled) setPost(null)
      })
      .finally(() => {
        if (!cancelled) setIsLoadingPost(false)
      })

    return () => {
      cancelled = true
    }
  }, [networkId, entityId, currentAddress])

  const postTextPreview = useMemo(() => {
    if (!post) return null

    if (post.content?.elements?.length > 0) {
      return post.content.elements[0]?.data?.text || ''
    }

    return typeof post.content === 'string' ? post.content : null
  }, [post])

  return (
    <article className={styles.activityRow}>
      <div className={`${styles.iconBox} ${styles.likedIcon}`}>
        <Heart size={18} fill="currentColor" style={{color: `var(--liked-color)`}} />
      </div>

      <div className={styles.rowBody}>
        <div className={styles.profileWrapper}>
          <Profile creator={targetAuthor} networkId={item.network_id} />
        </div>

        <div className={styles.messageGroup}>
          <strong>Liked Post by {targetAuthor?.slice(0, 6)}...{targetAuthor?.slice(-4)}</strong>
          
          {isLoadingPost && (
            <div className={styles.postPreviewLoader}>
              <LucideLoader2 className={styles.spin} size={12} />
              <span>Loading content...</span>
            </div>
          )}

          {postTextPreview && (
            <div className={styles.postPreview}>
              {postTextPreview}
            </div>
          )}

          <div className={styles.meta}>
            {item.entity_id && <span>Post #{item.entity_id}</span>}
            {item.created_at && <time>{toRelativeTime(item.created_at)}</time>}
          </div>
        </div>
      </div>

      {href && (
        <Link href={href} className={styles.openLink} aria-label="View original post">
          <ExternalLink size={16} />
        </Link>
      )}
    </article>
  )
}

function getPostHref(item) {
  const networkId = item.network_id || item.data?.network_id
  const entityId = item.entity_id || item.data?.parent_post_id || item.data?.post_id

  if (networkId && item.entity_type === 'post' && entityId) {
    return `/networks/${networkId}/${entityId}`
  }

  if (!item.action_url) return null

  if (item.action_url.startsWith('/posts/')) {
    const [path, queryString] = item.action_url.split('?')
    const postId = path.replace('/posts/', '')
    const params = new URLSearchParams(queryString || '')
    const legacyNetworkId = params.get('network_id') || networkId

    if (legacyNetworkId && postId) {
      return `/networks/${legacyNetworkId}/${postId}`
    }
  }

  return item.action_url
}
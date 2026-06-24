'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Bell,
  CheckCheck,
  Clock,
  ExternalLink,
  Heart,
  LucideLoader2,
  LucideRefreshCcw,
  MessageCircle,
  CirclePlus,
  User,
} from 'lucide-react'
import { useConnection, useSignMessage } from 'wagmi'
import Profile from '@/components/Profile'
import { toRelativeTime } from '@/lib/dateHelper'
import { getPostById, getViewPost } from '@/lib/api'
import styles from './ActivityFeed.module.scss'

const PAGE_SIZE = 20

const ACTION_META = {
  post_created: {
    icon: CirclePlus,
    label: 'Post created',
  },
  comment_created: {
    icon: MessageCircle,
    label: 'Comment created',
  },
  post_received_comment: {
    icon: MessageCircle,
    label: 'New comment',
  },
  post_liked: {
    icon: Heart,
    label: 'New like',
  },
  content_liked: {
    icon: Heart,
    label: 'New like',
  },
}

export default function ActivityFeed() {
  const { address, isConnected } = useConnection()
  const { mutateAsync: signMessageAsync } = useSignMessage()
  const [notifications, setNotifications] = useState([])
  const [nextPage, setNextPage] = useState(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)

  const pendingReadIds = useRef(new Set())
  const readBatchTimer = useRef(null)

  const markAllAsRead = useCallback(async () => {
    if (!address || unreadCount === 0) return

    const timestamp = Date.now()
    const message = `Mark all notifications as read\nTimestamp: ${timestamp}`

    let signature
    try {
      signature = await signMessageAsync({ message })
    } catch {
      return
    }

    setNotifications((prev) => prev.map((n) => (n.is_read ? n : { ...n, is_read: true, read_at: new Date().toISOString() })))
    setUnreadCount(0)

    try {
      await fetch('/api/v1/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mark_all: true, message, signature }),
      })
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err)
    }
  }, [address, unreadCount, signMessageAsync])

  const markAsRead = useCallback(
    (id) => {
      if (!address) return

      setNotifications((prev) =>
        prev.map((n) => (n.id === id && !n.is_read ? { ...n, is_read: true, read_at: new Date().toISOString() } : n)),
      )
      setUnreadCount((c) => Math.max(0, c - 1))

      pendingReadIds.current.add(id)
      clearTimeout(readBatchTimer.current)
      readBatchTimer.current = setTimeout(async () => {
        const ids = [...pendingReadIds.current]
        pendingReadIds.current.clear()
        try {
          await fetch('/api/v1/notifications', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, wallet_address: address }),
          })
        } catch (err) {
          console.error('Failed to mark notifications as read:', err)
        }
      }, 500)
    },
    [address],
  )

  const loadNotifications = useCallback(
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

        const response = await fetch(`/api/v1/notifications?${params}`, { signal })
        const payload = await response.json()

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || 'Failed to fetch notifications')
        }

        setNotifications((current) => (append ? [...current, ...payload.data] : payload.data))
        setNextPage(payload.nextPage)
        setUnreadCount(payload.meta?.unread_count || 0)
      } catch (err) {
        if (err.name === 'AbortError') return
        console.error('Notifications fetch error:', err)
        setError('Could not load notifications.')
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
      loadNotifications({ signal: controller.signal })
    }, 0)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [address, isConnected, loadNotifications])

  const visibleNotifications = useMemo(
    () =>
      isConnected && address
        ? notifications.filter(
            (notification) =>
              notification.recipient_wallet_address?.toLowerCase() === address.toLowerCase(),
          )
        : [],
    [address, isConnected, notifications],
  )
  const hasNotifications = visibleNotifications.length > 0
  const activeNextPage = hasNotifications ? nextPage : null
  const headerLabel = useMemo(() => {
    if (!hasNotifications || unreadCount === 0) return 'Notifications'
    return `${unreadCount} unread`
  }, [hasNotifications, unreadCount])

  if (!isConnected) {
    return (
      <div className={styles.container}>
        <div className={styles.status}>
          <User size={20} />
          Please connect your wallet to view activity.
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h4>
          <Activity size={18} />
          {headerLabel}
        </h4>
        <div className={styles.headerActions}>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllAsRead}
              className={styles.markAllButton}
              aria-label="Mark all as read"
              title="Mark all as read"
            >
              <CheckCheck size={14} />
              Mark all read
            </button>
          )}
          <button
            type="button"
            onClick={() => loadNotifications()}
            className={styles.refreshButton}
            disabled={isLoading}
            aria-label="Refresh notifications"
            title="Refresh notifications"
          >
            <LucideRefreshCcw className={isLoading ? styles.spin : undefined} size={16} />
          </button>
        </div>
      </div>

      <div className={styles.feed}>
        {!hasNotifications && isLoading ? (
          <div className={styles.status}>
            <LucideLoader2 className={styles.spin} size={16} />
            Loading notifications...
          </div>
        ) : null}

        {!hasNotifications && !isLoading ? (
          <div className={styles.status}>
            <Bell size={18} />
            No notifications yet.
          </div>
        ) : null}

        {visibleNotifications.map((notification) => (
          <NotificationRow
            key={notification.id}
            notification={notification}
            currentAddress={address}
            onRead={markAsRead}
          />
        ))}
      </div>

      <div className={styles.footer}>
        {activeNextPage ? (
          <button
            type="button"
            onClick={() => loadNotifications({ page: activeNextPage, append: true })}
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
          hasNotifications && (
            <div className={styles.status}>
              <Clock size={14} />
              You are all caught up
            </div>
          )
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}
function NotificationRow({ notification, currentAddress, onRead }) {
  const actor = notification.actor_wallet_address || notification.recipient_wallet_address
  const href = getNotificationHref(notification)
  const { icon: Icon, label } = ACTION_META[notification.action_type] || {
    icon: Bell,
    label: formatActionType(notification.action_type),
  }

  const rowRef = useRef(null)
  const hasMarkedRead = useRef(false)

  const [post, setPost] = useState(null)
  const [isLoadingPost, setIsLoadingPost] = useState(false)

  useEffect(() => {
    if (notification.is_read || !onRead) return

    const el = rowRef.current
    if (!el) return

    let readTimer = null

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasMarkedRead.current) {
          readTimer = setTimeout(() => {
            if (!hasMarkedRead.current) {
              hasMarkedRead.current = true
              onRead(notification.id)
              observer.disconnect()
            }
          }, 3000)
        } else {
          clearTimeout(readTimer)
          readTimer = null
        }
      },
      { threshold: 0.5 },
    )

    observer.observe(el)
    return () => {
      observer.disconnect()
      clearTimeout(readTimer)
    }
  }, [notification.id, notification.is_read, onRead])

  // Extract variables safely using top level parameters or data attributes
  const entityId = notification.data?.parent_post_id || notification.entity_id || notification.data?.post_id
  const networkId = notification.network_id || notification.data?.network_id

  useEffect(() => {
    if (!networkId || !entityId) return

    let cancelled = false
    setIsLoadingPost(true)

    // Using getPostById exactly like your working Post component
    getPostById(networkId, entityId, currentAddress)
      .then((res) => {
        if (cancelled) return

        const fetchedPost = Array.isArray(res?.data) ? res.data[0] : res?.data
        setPost(fetchedPost || null)
      })
      .catch((err) => {
        console.error('Error fetching notification content:', err)
        if (!cancelled) setPost(null)
      })
      .finally(() => {
        if (!cancelled) setIsLoadingPost(false)
      })

    return () => {
      cancelled = true
    }
  }, [networkId, entityId, currentAddress])

  // Mirror the text resolution structure from your Post component
  const postTextPreview = useMemo(() => {
    if (!post) return null

    if (post.content?.elements?.length > 0) {
      return post.content.elements[0]?.data?.text || ''
    }

    return typeof post.content === 'string' ? post.content : null
  }, [post])

  return (
    <article ref={rowRef} className={`${styles.activityRow} ${notification.is_read ? '' : styles.unread}`}>
      <div className={styles.iconBox}>
        <Icon size={18} />
      </div>

      <div className={styles.rowBody}>
        <div className={styles.profileWrapper}>
          <Profile creator={actor} networkId={notification.network_id} />
        </div>

        <div className={styles.messageGroup}>
          <strong>{notification.title || label}</strong>
          {notification.message && <p>{notification.message}</p>}
          
          {isLoadingPost && (
            <div className={styles.postPreviewLoader}>
              <LucideLoader2 className={styles.spin} size={12} />
              <span>Loading post content...</span>
            </div>
          )}

          {postTextPreview && (
            <div className={styles.postPreview}>
             {postTextPreview}
            </div>
          )}

          <div className={styles.meta}>
            <span>{label}</span>
            {notification.entity_id && <span>Post #{notification.entity_id}</span>}
            {notification.created_at && <time>{toRelativeTime(notification.created_at)}</time>}
          </div>
        </div>
      </div>

      {href && (
        <Link href={href} className={styles.openLink} aria-label="Open notification">
          <ExternalLink size={16} />
        </Link>
      )}
    </article>
  )
}
function getNotificationHref(notification) {
  const networkId = notification.network_id || notification.data?.network_id
  const entityId = notification.entity_id || notification.data?.parent_post_id || notification.data?.post_id

  if (networkId && notification.entity_type === 'post' && entityId) {
    return `/networks/${networkId}/${entityId}`
  }

  if (!notification.action_url) return null

  if (notification.action_url.startsWith('/posts/')) {
    const [path, queryString] = notification.action_url.split('?')
    const postId = path.replace('/posts/', '')
    const params = new URLSearchParams(queryString || '')
    const legacyNetworkId = params.get('network_id') || networkId

    if (legacyNetworkId && postId) {
      return `/networks/${legacyNetworkId}/${postId}`
    }
  }

  return notification.action_url
}

function formatActionType(actionType = 'notification') {
  return actionType
    .split('_')
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ')
}
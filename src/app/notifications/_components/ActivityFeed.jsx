'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { mutate as mutateGlobal } from 'swr'
import clsx from 'clsx'
import { ArrowsCounterClockwiseIcon, BellIcon, ChecksIcon, SpinnerIcon, UserIcon } from '@phosphor-icons/react'
import { useConnection, useSignMessage } from 'wagmi'
import NotificationRow from './NotificationRow'
import { FILTERS, buildGroups } from './notificationModel'
import styles from './ActivityFeed.module.scss'

// Rows collapse into groups, so a page of raw notifications yields far fewer visible rows — 40 keeps
// a first screen full without pushing past the endpoint's 50-row ceiling.
const PAGE_SIZE = 40
const EMPTY_COUNTS = { inbox: 0, mentions: 0, money: 0, you: 0 }
const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

export default function ActivityFeed({ debugAddress }) {
  const connection = useConnection()
  const address = debugAddress || connection.address
  const isConnected = debugAddress ? true : connection.isConnected
  const chain = connection.chain
  const { mutateAsync: signMessageAsync } = useSignMessage()

  const [filter, setFilter] = useState(FILTERS[0].id)
  const [notifications, setNotifications] = useState([])
  const [nextPage, setNextPage] = useState(null)
  const [unreadByFilter, setUnreadByFilter] = useState(EMPTY_COUNTS)
  const [isLoading, setIsLoading] = useState(false)
  const [isPaging, setIsPaging] = useState(false)
  const [error, setError] = useState(null)

  const pendingReadIds = useRef(new Set())
  const readBatchTimer = useRef(null)

  // Every notification is either something you did or something somebody else did, so those two
  // tabs already cover the table — Mentions and Money overlap them and must not be added in.
  const totalUnread = unreadByFilter.inbox + unreadByFilter.you

  const loadNotifications = useCallback(
    async ({ page = 1, append = false, signal } = {}) => {
      if (!address) return

      if (append) setIsPaging(true)
      else setIsLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({
          wallet_address: address,
          filter,
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
        setUnreadByFilter(payload.meta?.unread_by_filter || EMPTY_COUNTS)
      } catch (err) {
        if (err.name === 'AbortError') return
        console.error('Notifications fetch error:', err)
        setError('Could not load notifications.')
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false)
          setIsPaging(false)
        }
      }
    },
    [address, filter],
  )

  useEffect(() => {
    if (!isConnected || !address) return

    const controller = new AbortController()
    // Deferred by a tick so the fetch's own setState lands outside the effect body.
    const timer = setTimeout(() => loadNotifications({ signal: controller.signal }), 0)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [address, isConnected, loadNotifications])

  // A row can belong to several tabs at once (a reply counts under All and Mentions), so the tab
  // counters are re-read from the server after a write instead of guessed locally.
  const refreshCounts = useCallback(async () => {
    if (!address) return

    try {
      const response = await fetch(`/api/v1/notifications?wallet_address=${address}&counts_only=1`)
      const payload = await response.json()
      if (payload.success) setUnreadByFilter(payload.meta?.unread_by_filter || EMPTY_COUNTS)

      // The sidebar badge caches its count under its own SWR key; without this it keeps the stale
      // number until the next poll tick after rows are marked read here.
      mutateGlobal((key) => typeof key === 'string' && key.startsWith('/api/v1/notifications?'))
    } catch (err) {
      console.error('Failed to refresh notification counts:', err)
    }
  }, [address])

  // The previous tab's rows stay on screen, dimmed, until the new ones land — clearing first made
  // the feed collapse to skeletons and snap back on every tab press.
  const selectFilter = (next) => {
    if (next === filter) return

    setFilter(next)
    setNextPage(null)
  }

  const markAsRead = useCallback(
    (ids) => {
      if (!address || !ids?.length) return

      const idSet = new Set(ids.map(String))
      setNotifications((current) =>
        current.map((notification) =>
          idSet.has(String(notification.id)) && !notification.is_read
            ? { ...notification, is_read: true, read_at: new Date().toISOString() }
            : notification,
        ),
      )
      ids.forEach((id) => pendingReadIds.current.add(id))
      clearTimeout(readBatchTimer.current)
      readBatchTimer.current = setTimeout(async () => {
        const batch = [...pendingReadIds.current]
        pendingReadIds.current.clear()

        try {
          await fetch('/api/v1/notifications', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: batch, wallet_address: address }),
          })
          refreshCounts()
        } catch (err) {
          console.error('Failed to mark notifications as read:', err)
        }
      }, 500)
    },
    [address, refreshCounts],
  )

  const markAllAsRead = useCallback(async () => {
    if (!address || totalUnread === 0) return

    const message = `Mark all notifications as read\nTimestamp: ${Date.now()}`

    let signature
    try {
      signature = await signMessageAsync({ message })
    } catch {
      return
    }

    setNotifications((current) =>
      current.map((notification) =>
        notification.is_read ? notification : { ...notification, is_read: true, read_at: new Date().toISOString() },
      ),
    )
    setUnreadByFilter(EMPTY_COUNTS)

    // Universal Profiles sign through the account contract, so the route needs the UP address to
    // run the ERC-1271 check instead of a plain EOA recovery.
    const isLukso = chain?.id === 42 || chain?.id === 4201
    const body = { mark_all: true, message, signature, ...(isLukso && { up_address: address }) }

    try {
      await fetch('/api/v1/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      refreshCounts()
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err)
    }
  }, [address, chain, totalUnread, refreshCounts, signMessageAsync])

  const groups = useMemo(() => {
    if (!isConnected || !address) return []

    const owned = notifications.filter(
      (notification) => notification.recipient_wallet_address?.toLowerCase() === address.toLowerCase(),
    )
    return buildGroups(owned)
  }, [address, isConnected, notifications])

  const activeFilter = FILTERS.find((entry) => entry.id === filter) || FILTERS[0]
  const hasGroups = groups.length > 0

  if (!isConnected) {
    return (
      <div className={styles.feed}>
        <div className={styles.feed__status}>
          <UserIcon size={20} />
          Connect your wallet to see your notifications.
        </div>
      </div>
    )
  }

  return (
    <div className={styles.feed}>
      {/* The page name lives in the app header via PageTitle, so this bar carries only the
          tab switcher and the feed's own actions. */}
      <header className={styles.feed__header}>
        <nav className={styles.feed__tabs}>
          {FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={clsx(styles.feed__tab, entry.id === filter && styles['feed__tab--active'])}
              aria-current={entry.id === filter ? 'page' : undefined}
              onClick={() => selectFilter(entry.id)}
            >
              {entry.label}
              {/* Rendered on every tab, always: a counter that appears only once it has something
                  to say would re-measure the strip under the user's cursor. */}
              <span className={clsx(styles.feed__count, unreadByFilter[entry.id] === 0 && styles['feed__count--empty'])}>
                {compactNumber.format(unreadByFilter[entry.id] || 0)}
              </span>
            </button>
          ))}
        </nav>

        {/* Both buttons render unconditionally: a control appearing on state change would resize
            the tab strip beside it. */}
        <div className={styles.feed__actions}>
          <button
            type="button"
            className={styles.feed__action}
            onClick={markAllAsRead}
            disabled={totalUnread === 0}
            title="Mark all as read"
            aria-label="Mark all as read"
          >
            <ChecksIcon size={18} />
          </button>
          <button
            type="button"
            className={styles.feed__action}
            onClick={() => loadNotifications()}
            disabled={isLoading}
            title="Refresh"
            aria-label="Refresh notifications"
          >
            <ArrowsCounterClockwiseIcon className={clsx(isLoading && styles.feed__spin)} size={18} />
          </button>
        </div>
      </header>

      <div className={clsx(styles.feed__list, isLoading && hasGroups && styles['feed__list--busy'])}>
        {isLoading && !hasGroups && <SkeletonRows />}

        {!isLoading && !hasGroups && (
          <div className={styles.feed__empty}>
            <BellIcon size={28} />
            <p>{activeFilter.empty}</p>
          </div>
        )}

        {groups.map((group) => (
          <NotificationRow key={group.key} group={group} viewerAddress={address} onRead={markAsRead} />
        ))}
      </div>

      {error && <p className={styles.feed__error}>{error}</p>}

      {hasGroups && (
        <footer className={styles.feed__footer}>
          {nextPage ? (
            <button
              type="button"
              className={styles.feed__more}
              disabled={isPaging}
              onClick={() => loadNotifications({ page: nextPage, append: true })}
            >
              {isPaging ? <SpinnerIcon className={styles.feed__spin} size={16} /> : 'Show more'}
            </button>
          ) : (
            <span className={styles.feed__status}>You are all caught up</span>
          )}
        </footer>
      )}
    </div>
  )
}

function SkeletonRows() {
  return (
    <div aria-busy="true" aria-live="polite">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className={styles.feed__skeleton}>
          <span className={styles.feed__skeletonIcon} />
          <div className={styles.feed__skeletonBody}>
            <span className={styles.feed__skeletonAvatar} />
            <span className={styles.feed__skeletonLine} />
            <span className={clsx(styles.feed__skeletonLine, styles['feed__skeletonLine--short'])} />
          </div>
        </div>
      ))}
    </div>
  )
}

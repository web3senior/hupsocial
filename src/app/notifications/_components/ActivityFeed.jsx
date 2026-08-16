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

// Session-lifetime cache of loaded rows per wallet+filter: a revisit (or tab
// return) paints the previous data instantly and revalidates silently in the
// background — the skeleton only ever shows on the first visit. Same pattern
// as the home feed's useFeedCacheStore; module scope survives route unmounts,
// a full reload starts fresh.
const CACHE_TTL_MS = 10 * 60 * 1000
const sessionCache = new Map()

const readSessionCache = (key) => {
  const entry = sessionCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.savedAt > CACHE_TTL_MS) return null
  return entry
}

export default function ActivityFeed() {
  const { address, isConnected, chain } = useConnection()
  const { mutateAsync: signMessageAsync } = useSignMessage()

  // Snapshot from an earlier visit this session, if any. Safe to read in an
  // initializer: wagmi resolves the address synchronously on client-side
  // navigations, and after a hard reload the module cache is empty anyway.
  const [initialEntry] = useState(() => (address ? readSessionCache(`${address}|${FILTERS[0].id}`) : null))

  const [filter, setFilter] = useState(FILTERS[0].id)
  const [notifications, setNotifications] = useState(() => initialEntry?.notifications ?? [])
  const [nextPage, setNextPage] = useState(() => initialEntry?.nextPage ?? null)
  const [unreadByFilter, setUnreadByFilter] = useState(() => initialEntry?.unreadByFilter ?? EMPTY_COUNTS)
  const [isLoading, setIsLoading] = useState(false)
  const [isPaging, setIsPaging] = useState(false)
  const [error, setError] = useState(null)

  const pendingReadIds = useRef(new Set())
  const readBatchTimer = useRef(null)
  // Cache key the on-screen rows belong to. During a tab switch the previous
  // tab's rows stay visible until the new data lands, so cache writes must
  // target the key that was applied, not the freshly selected one.
  const appliedKeyRef = useRef(initialEntry ? `${address}|${FILTERS[0].id}` : null)

  // Every notification is either something you did or something somebody else did, so those two
  // tabs already cover the table — Mentions and Money overlap them and must not be added in.
  const totalUnread = unreadByFilter.inbox + unreadByFilter.you

  const loadNotifications = useCallback(
    async ({ page = 1, append = false, silent = false, signal } = {}) => {
      if (!address) return

      // Silent revalidation: cached rows are already on screen, so no skeleton
      // and no busy-dim — fresh data just replaces them when it lands.
      if (append) setIsPaging(true)
      else if (!silent) setIsLoading(true)
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
        appliedKeyRef.current = `${address}|${filter}`
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

    // Rows for this wallet+filter already on screen (mount hydration or a tab
    // switch that hit the cache) — revalidate without the skeleton or dim.
    const silent = appliedKeyRef.current === `${address}|${filter}`

    const controller = new AbortController()
    // Deferred by a tick so the fetch's own setState lands outside the effect body.
    const timer = setTimeout(() => loadNotifications({ signal: controller.signal, silent }), 0)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [address, isConnected, filter, loadNotifications])

  // Keep the cache in step with whatever the rows currently show — including
  // local read-state flips — so a revisit never resurrects unread badges the
  // user already cleared.
  useEffect(() => {
    if (!appliedKeyRef.current) return
    sessionCache.set(appliedKeyRef.current, { notifications, nextPage, unreadByFilter, savedAt: Date.now() })
  }, [notifications, nextPage, unreadByFilter])

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
  // the feed collapse to skeletons and snap back on every tab press. A cached tab swaps in its
  // rows immediately instead (event handler, so direct setState is fine) and revalidates silently.
  const selectFilter = (next) => {
    if (next === filter) return

    setFilter(next)
    setNextPage(null)

    const cached = address ? readSessionCache(`${address}|${next}`) : null
    if (cached) {
      setNotifications(cached.notifications)
      setNextPage(cached.nextPage)
      setUnreadByFilter(cached.unreadByFilter)
      appliedKeyRef.current = `${address}|${next}`
    }
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
    const isLukso = chain?.id === 42
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
              {/* Tabs are fixed equal widths, so a counter coming or going re-centres its own
                  label without moving anything else — no reserved slot needed. */}
              {unreadByFilter[entry.id] > 0 && (
                <span className={styles.feed__count}>{compactNumber.format(unreadByFilter[entry.id])}</span>
              )}
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

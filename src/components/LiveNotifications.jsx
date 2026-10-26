'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { mutate as mutateGlobal } from 'swr'
import { BellIcon } from '@phosphor-icons/react'
import { toast } from '@/components/NextToast'
import { useActiveWallet } from '@/hooks/useActiveWallet'
import { DEFAULT_USERNAME, profileFetcher } from '@/hooks/useProfile'
import { normalizeAddress, shortAddress } from '@/lib/address'
import { buildGroups, hrefOf } from '@/app/notifications/_components/notificationModel'

// Rows landing within this window share one flush, so twenty likes in a second are one toast
const BURST_MS = 1500
// More groups than this in a flush fold into a single "N new notifications" summary
const MAX_GROUP_TOASTS = 2
const CATCH_UP_LIMIT = 50
// Only used when the stream cannot be opened at all
const FALLBACK_POLL_MS = 20_000
// A toast is not worth waiting on a slow profile lookup; the address stands in after this
const NAME_TIMEOUT_MS = 1500

const FEED_KEY_PREFIX = '/api/v1/notifications?'

const countFormat = new Intl.NumberFormat('en')
const listFormat = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' })
const pluralRules = new Intl.PluralRules('en')

const TONE_NOUNS = {
  like: { one: 'like', other: 'likes' },
  repost: { one: 'repost', other: 'reposts' },
  reply: { one: 'reply', other: 'replies' },
  follow: { one: 'follow', other: 'follows' },
  money: { one: 'payment', other: 'payments' },
  market: { one: 'market update', other: 'market updates' },
  neutral: { one: 'update', other: 'updates' },
}

const plural = (count, forms) => `${countFormat.format(count)} ${forms[pluralRules.select(count)] ?? forms.other}`

// The newest id this browser has already toasted, shared by every tab through localStorage so a
// notification is announced once however many tabs are open.
const lastSeenKey = (wallet) => `hup:notifications:last-seen:${wallet}`

const readLastSeen = (wallet) => {
  try {
    return Number(localStorage.getItem(lastSeenKey(wallet))) || 0
  } catch {
    return 0
  }
}

const writeLastSeen = (wallet, id) => {
  try {
    if (id > readLastSeen(wallet)) localStorage.setItem(lastSeenKey(wallet), String(id))
  } catch {
    /* Private mode: toasts may repeat across tabs, nothing worse */
  }
}

const refreshFeed = () => mutateGlobal((key) => typeof key === 'string' && key.startsWith(FEED_KEY_PREFIX))

async function displayNameOf(address) {
  const timeout = new Promise((resolve) => setTimeout(resolve, NAME_TIMEOUT_MS, null))
  const profile = await Promise.race([profileFetcher(address).catch(() => null), timeout])
  return profile?.name && profile.name !== DEFAULT_USERNAME ? profile.name : shortAddress(address)
}

/** "Alice liked your post" / "Alice and 3 others liked your post", or the indexer's own sentence. */
async function sentenceOf(group) {
  const { meta, actors, latest } = group
  if (!meta.verb || actors.length === 0) return latest.message || latest.title || 'New notification'

  const name = await displayNameOf(actors[0])
  const extra = actors.length - 1
  const who = extra > 0 ? listFormat.format([name, plural(extra, { one: 'other', other: 'others' })]) : name
  return `${who} ${meta.verb}`
}

async function announce(rows) {
  const groups = buildGroups(rows)

  if (groups.length > MAX_GROUP_TOASTS) {
    const byTone = new Map()
    groups.forEach(({ meta, total }) => byTone.set(meta.tone, (byTone.get(meta.tone) ?? 0) + total))
    const parts = [...byTone].map(([tone, count]) => plural(count, TONE_NOUNS[tone] ?? TONE_NOUNS.neutral))

    toast(plural(rows.length, { one: 'new notification', other: 'new notifications' }), 'notification', {
      icon: <BellIcon size={20} weight="fill" />,
      href: '/notifications',
      footer: listFormat.format(parts),
    })
    return
  }

  const items = await Promise.all(groups.map(async (group) => ({ group, sentence: await sentenceOf(group) })))
  // Oldest first, so the newest ends up as the front card of the stack
  items.reverse().forEach(({ group, sentence }) => {
    const Icon = group.meta.icon
    toast(sentence, 'notification', {
      icon: <Icon size={20} weight={group.meta.weight ?? 'regular'} />,
      tone: group.meta.tone,
      href: hrefOf(group) || '/notifications',
    })
  })
}

/**
 * Live toasts for what other people do to you — likes, reposts, replies, follows, mentions,
 * tips. Renders nothing.
 *
 * - One tab per wallet (elected with a Web Lock) holds the SSE connection to
 *   /api/v1/notifications/stream and relays each row to the other tabs over a BroadcastChannel,
 *   so ten open tabs still cost the server one connection.
 * - Every tab refreshes its notification SWR keys (sidebar badge, open feed) on each row, but only
 *   a visible tab toasts. A hidden tab announces nothing and catches up — through `after_id`, in
 *   one grouped toast — when it is looked at again, which also covers opening the app.
 * - On /notifications the rows are already on screen, so nothing is toasted there.
 */
export default function LiveNotifications() {
  const { address, isConnected } = useActiveWallet()
  const wallet = isConnected ? normalizeAddress(address) : null
  const pathname = usePathname()
  const pathnameRef = useRef(pathname)

  useEffect(() => {
    pathnameRef.current = pathname
  }, [pathname])

  useEffect(() => {
    if (!wallet) return undefined

    let disposed = false
    let flushTimer = null
    const buffer = []

    const flush = () => {
      flushTimer = null
      const lastSeen = readLastSeen(wallet)
      const fresh = buffer
        .splice(0)
        .filter((row) => Number(row.id) > lastSeen && !row.is_read)
        .sort((left, right) => Number(right.id) - Number(left.id))
      if (disposed || fresh.length === 0) return

      writeLastSeen(wallet, Number(fresh[0].id))
      if (pathnameRef.current?.startsWith('/notifications')) return
      announce(fresh)
    }

    const deliver = (rows, { immediate = false } = {}) => {
      // Left unannounced on purpose: the catch-up picks these up when the tab is looked at
      if (document.visibilityState !== 'visible' || rows.length === 0) return
      buffer.push(...rows)
      if (immediate) {
        clearTimeout(flushTimer)
        flush()
      } else {
        flushTimer ??= setTimeout(flush, BURST_MS)
      }
    }

    const catchUp = async () => {
      if (document.visibilityState !== 'visible') return
      const params = new URLSearchParams({
        wallet_address: wallet,
        filter: 'inbox',
        unread: '1',
        limit: String(CATCH_UP_LIMIT),
        after_id: String(readLastSeen(wallet)),
      })
      try {
        const response = await fetch(`/api/v1/notifications?${params}`)
        const body = await response.json()
        if (!disposed && body?.success) deliver(body.data ?? [], { immediate: true })
      } catch {
        /* Offline: the next visibility change or reconnect tries again */
      }
    }

    const onLive = (notification) => {
      refreshFeed()
      deliver([notification])
    }

    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`hup-live-notifications:${wallet}`)
    if (channel) {
      channel.onmessage = (event) => {
        if (event.data?.type === 'notification') onLive(event.data.notification)
      }
    }

    // --- Leader: the one tab that holds the stream ---
    let source = null
    let pollTimer = null
    let releaseLeadership = null

    const startPolling = () => {
      if (pollTimer || disposed) return
      pollTimer = setInterval(() => {
        refreshFeed()
        catchUp()
      }, FALLBACK_POLL_MS)
    }

    const openStream = () => {
      if (typeof EventSource === 'undefined') {
        startPolling()
        return
      }

      let hasOpened = false
      source = new EventSource(`/api/v1/notifications/stream?wallet=${encodeURIComponent(wallet)}`)
      source.onopen = () => {
        // A reconnect may have missed rows written while the connection was down
        if (hasOpened) catchUp()
        hasOpened = true
      }
      source.addEventListener('notification', (event) => {
        let notification
        try {
          notification = JSON.parse(event.data)
        } catch {
          return
        }
        channel?.postMessage({ type: 'notification', notification })
        onLive(notification)
      })
      source.onerror = () => {
        // CONNECTING means EventSource is retrying by itself; CLOSED means the server refused
        if (source?.readyState === EventSource.CLOSED) {
          source = null
          startPolling()
        }
      }
    }

    const lockController = new AbortController()
    if (navigator.locks?.request) {
      navigator.locks
        .request(`hup-live-notifications:${wallet}`, { signal: lockController.signal }, () => {
          if (disposed) return undefined
          openStream()
          // Held until this effect is torn down, then the next tab in line takes over
          return new Promise((resolve) => {
            releaseLeadership = resolve
          })
        })
        .catch(() => {
          /* Aborted while waiting in line */
        })
    } else {
      openStream()
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') catchUp()
    }
    document.addEventListener('visibilitychange', onVisibility)
    catchUp()

    return () => {
      disposed = true
      clearTimeout(flushTimer)
      clearInterval(pollTimer)
      source?.close()
      channel?.close()
      lockController.abort()
      releaseLeadership?.()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [wallet])

  return null
}

'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import useSWR from 'swr'
import clsx from 'clsx'
import { useChainId, useConnection, useSignMessage } from 'wagmi'
import {
  ArrowDownIcon,
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  ChatCircleIcon,
  DotsThreeIcon,
  GifIcon,
  PaperPlaneRightIcon,
  PaperPlaneTiltIcon,
  ShieldCheckIcon,
  XIcon,
} from '@phosphor-icons/react'
import Link from 'next/link'
import Profile from '@/components/Profile'
import Avatar from '@/components/ui/Avatar'
import MentionPicker from '@/components/MentionPicker'
import { useProfile } from '@/hooks/useProfile'
import EmojiPicker from '@/components/EmojiPicker'
import GifPicker from '@/components/GifPicker'
import EmptyState from '@/components/ui/EmptyState'
import NativePopover from '@/components/ui/NativePopover'
import { toast } from '@/components/NextToast'
import { openConnect } from '@/lib/connectDialog'
import { toRelativeTime } from '@/lib/dateHelper'
import { sameAddress } from '@/lib/address'
import { splitChatText } from '@/lib/chatText'
import { mentionLabel, mentionMarkdown } from '@/lib/mentions'
import {
  clearChatToken,
  ensureChatSession,
  fetchChatMe,
  fetchRoomMessages,
  fetchRoomUnread,
  isChatUnauthorized,
  moderateChat,
  readChatToken,
  sendRoomMessage,
  subscribeChatToken,
} from '@/lib/chatApi'
import { useChatDockStore } from '@/stores/useChatDockStore'
import styles from './ChatDock.module.scss'

const POLL_LIVE_MS = 4_000
const POLL_MINIMIZED_MS = 30_000
const BODY_MAX_CHARS = 1000
// Two lines from one wallet within this gap share a run
const GROUP_GAP_MS = 5 * 60_000
// A centred timestamp separates lines further apart than this
const STAMP_GAP_MS = 15 * 60_000
// How close to an edge of the loaded window the reader has to be before the next page loads
const EDGE_PX = 120
const BAN_CHOICES = [1, 3, 7, 30]
const MOBILE_QUERY = '(max-width: 767px)'
// The card can be dragged to the edge but never past it
const DRAG_MARGIN = 8
// How long the room waits for a remembered wallet to come back before rendering without it
const WALLET_GRACE_MS = 4_000
// An `@` and what follows it, up to the caret, when nothing but a space or the start sits before
const MENTION_QUERY_PATTERN = /(^|\s)@([^\s@]{0,48})$/

const compactCount = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 0 })
const stampDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const noopSubscribe = () => () => {}

const numericId = (message) => (typeof message.id === 'number' ? message.id : 0)

const parseTime = (value) => new Date(String(value).replace(' ', 'T')).getTime()

/**
 * Consecutive lines from one wallet within GROUP_GAP_MS form a run that shares one face and
 * one name. A run also breaks at a timestamp and at the "new messages" divider.
 * @returns {Array<{key: string, sender: string, stamped: boolean, divider: boolean, messages: object[]}>}
 */
const groupRuns = (messages, openedAtId) => {
  const runs = []
  messages.forEach((message, index) => {
    const previous = messages[index - 1]
    const gap = previous ? parseTime(message.createdAt) - parseTime(previous.createdAt) : Infinity
    const stamped = gap > STAMP_GAP_MS
    const divider = openedAtId > 0 && numericId(message) > openedAtId && (!previous || numericId(previous) <= openedAtId)
    const current = runs[runs.length - 1]
    if (current && !stamped && !divider && sameAddress(current.sender, message.sender) && gap < GROUP_GAP_MS) {
      current.messages.push(message)
      return
    }
    runs.push({ key: String(message.id), sender: message.sender, stamped, divider, messages: [message] })
  })
  return runs
}

const mergeSorted = (current, incoming) => {
  const seen = new Set(current.map((message) => message.id))
  const next = [...current, ...incoming.filter((message) => !seen.has(message.id))]
  next.sort((a, b) => numericId(a) - numericId(b))
  return next
}

/**
 * The public chat room as a messenger card in the bottom-right corner: a pill when minimized,
 * a card when open, a taller card when expanded. Anyone can read; posting takes one wallet
 * signature. The loaded window is a slice of the room paged from a cursor in both directions, so
 * a reader who left days ago reopens on the line they left and reads forward from there.
 * Distinct from the onchain /chat page, which it stays off.
 */
export default function ChatDock() {
  const pathname = usePathname()
  const { address, isConnected, status } = useConnection()
  const { signMessageAsync } = useSignMessage()
  const chainId = useChainId()

  const mode = useChatDockStore((state) => state.mode)
  const lastSeenId = useChatDockStore((state) => state.lastSeenId)
  const open = useChatDockStore((state) => state.open)
  const minimize = useChatDockStore((state) => state.minimize)
  const toggleExpanded = useChatDockStore((state) => state.toggleExpanded)
  const markSeen = useChatDockStore((state) => state.markSeen)
  const offset = useChatDockStore((state) => state.offset)
  const setOffset = useChatDockStore((state) => state.setOffset)
  const isOpen = mode !== 'minimized'

  const me = isConnected && address ? address.toLowerCase() : null

  // Connectors restore a wallet some time after the first paint, and wagmi reports
  // "disconnected" until they start. Rendering the room in that window paints the reader's own
  // lines as somebody else's, then flips them. So the last wallet seen is remembered, and while
  // it has not come back the room shows a skeleton, for a bounded grace period; a wallet the
  // reader disconnected on purpose is forgotten and the room renders at once.
  const lastAddress = useChatDockStore((state) => state.lastAddress)
  const setLastAddress = useChatDockStore((state) => state.setLastAddress)
  const [graceOver, setGraceOver] = useState(false)
  const wasConnectedRef = useRef(false)
  useEffect(() => {
    if (me) {
      wasConnectedRef.current = true
      if (me !== lastAddress) setLastAddress(me)
      return
    }
    if (wasConnectedRef.current && status === 'disconnected') {
      wasConnectedRef.current = false
      setLastAddress(null)
    }
  }, [me, status, lastAddress, setLastAddress])
  useEffect(() => {
    if (me || !lastAddress) return undefined
    const timer = setTimeout(() => setGraceOver(true), WALLET_GRACE_MS)
    return () => clearTimeout(timer)
  }, [me, lastAddress])
  const isSettling = !me && Boolean(lastAddress) && !graceOver

  // The mode is persisted, so the server never renders the dock: its first paint is the
  // client's, from localStorage, and there is nothing to mismatch
  const isClient = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  )
  const token = useSyncExternalStore(
    subscribeChatToken,
    () => readChatToken(me),
    () => null
  )
  const [isSigningIn, setIsSigningIn] = useState(false)

  const hidden = !isClient || pathname === '/chat'

  const { data: chatMe, mutate: mutateChatMe } = useSWR(token ? ['chat-me', token] : null, () => fetchChatMe(token), {
    revalidateOnFocus: false,
    onError: (error) => {
      if (isChatUnauthorized(error)) clearChatToken(me)
    },
  })

  const signIn = useCallback(async () => {
    if (!me || isSigningIn) return
    setIsSigningIn(true)
    try {
      await ensureChatSession(me, signMessageAsync, chainId)
    } catch (error) {
      if (error?.name !== 'UserRejectedRequestError') toast(error?.message || 'Could not sign in to chat', 'error')
    } finally {
      setIsSigningIn(false)
    }
  }, [me, isSigningIn, signMessageAsync, chainId])

  // Unread while minimized: a cheap count newer than the last seen line, plus the faces of the
  // last few people who spoke
  const [unread, setUnread] = useState(0)
  const [recentSenders, setRecentSenders] = useState([])
  // Unread lines that mention the reader: the badge turns into an @ and opening lands on the first
  const [mentionAlert, setMentionAlert] = useState({ count: 0, firstId: 0 })
  useEffect(() => {
    if (hidden || isOpen) return undefined
    let cancelled = false
    const check = async () => {
      try {
        const data = await fetchRoomUnread(lastSeenId, me)
        if (cancelled) return
        setUnread(data.count)
        setRecentSenders(data.recentSenders ?? [])
        setMentionAlert({ count: data.mentions ?? 0, firstId: data.firstMentionId ?? 0 })
      } catch {
        /* The next tick tries again */
      }
    }
    check()
    const timer = setInterval(check, POLL_MINIMIZED_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [hidden, isOpen, lastSeenId, me])

  const onSeen = useCallback(() => {
    setUnread(0)
    setMentionAlert({ count: 0, firstId: 0 })
  }, [])

  const { dockRef, dragProps, isDragging, dragStyle } = useDraggableCard({ enabled: isOpen, offset, setOffset })

  if (hidden) return null

  // An @ badge when the reader was mentioned, the way Telegram flags a chat; the count otherwise
  const badge =
    mentionAlert.count > 0 ? (
      <span
        className={clsx(styles.badge, styles['badge--mention'])}
        title={`${mentionAlert.count} mention${mentionAlert.count > 1 ? 's' : ''}`}
      >
        @
      </span>
    ) : (
      unread > 0 && <span className={styles.badge}>{compactCount.format(unread)}</span>
    )

  return (
    <section
      ref={dockRef}
      className={clsx(styles.dock, styles[`dock--${mode}`], isDragging && styles['dock--dragging'])}
      style={dragStyle}
      aria-label="Chat"
    >
      {isOpen ? (
        <>
          <header className={styles.dock__bar} {...dragProps}>
            <div className={styles.dock__title}>
              <span>Chat</span>
              {badge}
            </div>
            <div className={styles.dock__actions}>
              <button
                type="button"
                className={clsx(styles.dock__iconButton, styles['dock__iconButton--expand'])}
                onClick={toggleExpanded}
                aria-label={mode === 'expanded' ? 'Shrink chat' : 'Expand chat'}
                title={mode === 'expanded' ? 'Shrink' : 'Expand'}
              >
                {mode === 'expanded' ? <ArrowsInSimpleIcon size={18} weight="bold" /> : <ArrowsOutSimpleIcon size={18} weight="bold" />}
              </button>
              <button type="button" className={styles.dock__iconButton} onClick={minimize} aria-label="Minimize chat" title="Minimize">
                <XIcon size={20} weight="bold" />
              </button>
            </div>
          </header>
          {isSettling && <RoomSkeleton />}
        </>
      ) : (
        <button type="button" className={styles.pill} onClick={open} aria-label="Maximize chat" title="Open chat">
          <span className={styles.pill__icon}>
            <PaperPlaneTiltIcon size={22} />
            {badge}
          </span>
          <span className={styles.pill__label}>Chat</span>
          {recentSenders.length > 0 && (
            <span className={styles.pill__faces}>
              {recentSenders.map((wallet) => (
                <PillFace key={wallet} wallet={wallet} />
              ))}
            </span>
          )}
        </button>
      )}

      {/* Mounted once and kept across close/open, so reopening lands exactly where the reader
          left instead of refetching and re-scrolling; hidden, it neither polls nor marks seen */}
      {!isSettling && (
        <div className={styles.dock__room} hidden={!isOpen}>
          <Room
            active={isOpen}
            focusId={mentionAlert.firstId}
            me={me}
            token={token}
            chatMe={chatMe}
            lastSeenId={lastSeenId}
            markSeen={markSeen}
            onSeen={onSeen}
            onSignIn={signIn}
            isSigningIn={isSigningIn}
            onConnect={() => openConnect() || minimize()}
            onModerated={() => mutateChatMe()}
          />
        </div>
      )}
    </section>
  )
}

/**
 * Drag the open card around by its bar. The shift from the card's corner seat is what is kept,
 * so a resized window re-clamps it rather than losing it; a press on a button in the bar is
 * left to the button. Phones show the room edge to edge and have nothing to drag.
 */
function useDraggableCard({ enabled, offset, setOffset }) {
  const dockRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef(null)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY)
    const sync = () => setIsMobile(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  const clamp = useCallback(
    (next) => {
      const dock = dockRef.current
      if (!dock) return next
      const rect = dock.getBoundingClientRect()
      const applied = dragRef.current?.applied ?? offset
      // The seat is where the card sits with no shift at all
      const seatLeft = rect.left - applied.x
      const seatTop = rect.top - applied.y
      const minX = DRAG_MARGIN - seatLeft
      const maxX = window.innerWidth - DRAG_MARGIN - rect.width - seatLeft
      const minY = DRAG_MARGIN - seatTop
      const maxY = window.innerHeight - DRAG_MARGIN - rect.height - seatTop
      return {
        x: Math.min(Math.max(next.x, Math.min(minX, maxX)), Math.max(minX, maxX)),
        y: Math.min(Math.max(next.y, Math.min(minY, maxY)), Math.max(minY, maxY)),
      }
    },
    [offset]
  )

  // A window that shrinks, or a card that grows (expand after a drag to the top), pulls a card
  // that would fall off the edge back in. The card's own size is observed rather than the mode,
  // since the height animates and only the settled size says where the edges are.
  useEffect(() => {
    if (!enabled || isMobile) return undefined
    const dock = dockRef.current
    const reclamp = () => {
      if (dragRef.current) return
      const next = clamp(offset)
      if (next.x !== offset.x || next.y !== offset.y) setOffset(next)
    }
    reclamp()
    window.addEventListener('resize', reclamp)
    const observer = dock ? new ResizeObserver(reclamp) : null
    observer?.observe(dock)
    return () => {
      window.removeEventListener('resize', reclamp)
      observer?.disconnect()
    }
  }, [enabled, isMobile, offset, clamp, setOffset])

  const onPointerDown = (event) => {
    if (isMobile || event.button !== 0 || event.target.closest('button')) return
    dragRef.current = { startX: event.clientX, startY: event.clientY, origin: offset, applied: offset }
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsDragging(true)
  }

  const onPointerMove = (event) => {
    const drag = dragRef.current
    if (!drag) return
    const next = clamp({ x: drag.origin.x + event.clientX - drag.startX, y: drag.origin.y + event.clientY - drag.startY })
    drag.applied = next
    const dock = dockRef.current
    if (dock) dock.style.transform = `translate(${next.x}px, ${next.y}px)`
  }

  const endDrag = (event) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setIsDragging(false)
    setOffset(drag.applied)
  }

  // Always set while draggable, so a drag that lands back on the seat still overwrites the
  // transform the pointer handler wrote straight to the element
  const dragStyle = enabled && !isMobile ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined

  return {
    dockRef,
    isDragging,
    dragStyle,
    dragProps: isMobile ? {} : { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag },
  }
}

// Stands in for the room while the remembered wallet comes back: a few bubbles on each side
function RoomSkeleton() {
  return (
    <div className={styles.room} aria-busy="true" aria-label="Loading chat">
      <div className={styles.skeleton}>
        <span className={clsx(styles.skeleton__bubble, styles['skeleton__bubble--theirs'])} style={{ width: '58%' }} />
        <span className={clsx(styles.skeleton__bubble, styles['skeleton__bubble--theirs'])} style={{ width: '34%' }} />
        <span className={clsx(styles.skeleton__bubble, styles['skeleton__bubble--mine'])} style={{ width: '46%' }} />
        <span className={clsx(styles.skeleton__bubble, styles['skeleton__bubble--theirs'])} style={{ width: '64%' }} />
        <span className={clsx(styles.skeleton__bubble, styles['skeleton__bubble--mine'])} style={{ width: '28%' }} />
      </div>
    </div>
  )
}

// A face inside the pill button: a link would nest an interactive element in another, so this
// is the one identity that renders as a bare picture
function PillFace({ wallet }) {
  const { profile } = useProfile(wallet)
  return <Avatar src={profile?.profileImage} size={28} alt="" title={profile?.name} className={styles.pill__face} />
}

function Room({ active, focusId = 0, me, token, chatMe, lastSeenId, markSeen, onSeen, onSignIn, isSigningIn, onConnect, onModerated }) {
  const [messages, setMessages] = useState(null)
  const [hasOlder, setHasOlder] = useState(false)
  const [hasNewer, setHasNewer] = useState(false)
  const [isPaging, setIsPaging] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const listRef = useRef(null)
  const serverTimeRef = useRef(null)
  const pagingRef = useRef(false)
  // Where the reader was when the room opened: the divider sits after this line
  const [openedAtId] = useState(lastSeenId)
  const dividerRef = useRef(null)
  const [initialScrollDone, setInitialScrollDone] = useState(false)
  const contentRef = useRef(null)
  // Where the reader was, tracked on every scroll: a hidden element reads 0, so it cannot be
  // asked at the moment the card closes
  const savedScrollRef = useRef(0)

  const isLoaded = messages !== null
  const minId = messages?.length ? numericId(messages[0]) : 0
  const maxId = messages?.length ? numericId(messages[messages.length - 1]) : 0

  const applyRemoved = useCallback((removed) => {
    if (!removed?.length) return
    const gone = new Set(removed)
    setMessages((current) => (current ?? []).filter((message) => !gone.has(message.id)))
  }, [])

  // Initial window: the page around the last seen line when there is one, else the newest page
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        if (openedAtId > 0) {
          const [olderPage, newerPage] = await Promise.all([
            fetchRoomMessages({ before: openedAtId + 1 }),
            fetchRoomMessages({ after: openedAtId }),
          ])
          if (cancelled) return
          serverTimeRef.current = newerPage.serverTime
          setMessages(mergeSorted(olderPage.messages, newerPage.messages))
          setHasOlder(olderPage.hasMore)
          setHasNewer(newerPage.hasMore)
        } else {
          const page = await fetchRoomMessages()
          if (cancelled) return
          serverTimeRef.current = page.serverTime
          setMessages(page.messages)
          setHasOlder(page.hasMore)
          setHasNewer(false)
        }
      } catch {
        if (!cancelled) setMessages([])
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [openedAtId])

  // First paint of the window: rest on the divider when there is one, else on the newest line
  useEffect(() => {
    if (!isLoaded || !active || initialScrollDone) return
    const list = listRef.current
    if (!list) return
    if (dividerRef.current) {
      list.scrollTop = Math.max(0, dividerRef.current.offsetTop - 48)
    } else {
      list.scrollTop = list.scrollHeight
    }
    setInitialScrollDone(true)
  }, [isLoaded, active, initialScrollDone])

  // Polling only at the live edge; a reader still catching up loads forward by scrolling
  useEffect(() => {
    if (!isLoaded || hasNewer || !active) return undefined
    let cancelled = false
    const tick = async () => {
      try {
        const data = await fetchRoomMessages({ after: maxId, deletedSince: serverTimeRef.current })
        if (cancelled) return
        serverTimeRef.current = data.serverTime
        applyRemoved(data.removed)
        if (data.messages.length) setMessages((current) => mergeSorted(current ?? [], data.messages))
        if (data.hasMore) setHasNewer(true)
      } catch {
        /* The next tick tries again */
      }
    }
    if (maxId > 0) tick()
    const timer = setInterval(tick, POLL_LIVE_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [isLoaded, hasNewer, maxId, active, applyRemoved])

  // Following the newest line while the reader sits at the bottom
  const stickRef = useRef(true)
  useEffect(() => {
    const list = listRef.current
    if (list && active && stickRef.current && initialScrollDone) list.scrollTop = list.scrollHeight
  }, [maxId, active, initialScrollDone])

  // A GIF or a face that finishes loading grows the content under the reader; while they sit
  // at the bottom the view stays pinned there, so nothing ever jumps
  useEffect(() => {
    const list = listRef.current
    const content = contentRef.current
    if (!list || !content || !active) return undefined
    const observer = new ResizeObserver(() => {
      if (stickRef.current) list.scrollTop = list.scrollHeight
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [active, isLoaded])

  // Reopening puts the reader back where they were, or at the bottom if that is where they sat;
  // an unread mention wins over both, so the card opens on the line that called them
  useEffect(() => {
    if (!active || !initialScrollDone) return undefined
    const frame = requestAnimationFrame(() => {
      const list = listRef.current
      if (!list) return
      const mentioned = focusId > 0 ? list.querySelector(`[data-line-id="${focusId}"]`) : null
      if (mentioned) {
        stickRef.current = false
        list.scrollTop = Math.max(0, mentioned.offsetTop - list.offsetTop - 48)
        return
      }
      list.scrollTop = stickRef.current ? list.scrollHeight : savedScrollRef.current
    })
    return () => cancelAnimationFrame(frame)
  }, [active, initialScrollDone, focusId])

  // What the reader has scrolled to the bottom of has been seen
  useEffect(() => {
    if (active && atBottom && !hasNewer && maxId > 0) {
      markSeen(maxId)
      onSeen()
    }
  }, [active, atBottom, hasNewer, maxId, markSeen, onSeen])

  const loadOlder = useCallback(async () => {
    if (pagingRef.current || !hasOlder || !minId) return
    pagingRef.current = true
    setIsPaging(true)
    const list = listRef.current
    const heightBefore = list?.scrollHeight ?? 0
    try {
      const page = await fetchRoomMessages({ before: minId })
      setMessages((current) => mergeSorted(current ?? [], page.messages))
      setHasOlder(page.hasMore)
      // Keep the line the reader was on where it was while the older page lands above it
      requestAnimationFrame(() => {
        if (list) list.scrollTop += list.scrollHeight - heightBefore
      })
    } catch {
      /* Scrolling again retries */
    } finally {
      pagingRef.current = false
      setIsPaging(false)
    }
  }, [hasOlder, minId])

  const loadNewer = useCallback(async () => {
    if (pagingRef.current || !hasNewer || !maxId) return
    pagingRef.current = true
    setIsPaging(true)
    try {
      const page = await fetchRoomMessages({ after: maxId, deletedSince: serverTimeRef.current })
      serverTimeRef.current = page.serverTime
      applyRemoved(page.removed)
      setMessages((current) => mergeSorted(current ?? [], page.messages))
      setHasNewer(page.hasMore)
    } catch {
      /* Scrolling again retries */
    } finally {
      pagingRef.current = false
      setIsPaging(false)
    }
  }, [hasNewer, maxId, applyRemoved])

  const onScroll = () => {
    const list = listRef.current
    if (!list) return
    if (!active) return
    savedScrollRef.current = list.scrollTop
    const fromBottom = list.scrollHeight - list.scrollTop - list.clientHeight
    const bottom = fromBottom < 40
    stickRef.current = bottom && !hasNewer
    setAtBottom(bottom)
    if (list.scrollTop < EDGE_PX) loadOlder()
    if (fromBottom < EDGE_PX) loadNewer()
  }

  const jumpToLatest = async () => {
    try {
      const page = await fetchRoomMessages()
      serverTimeRef.current = page.serverTime
      setMessages(page.messages)
      setHasOlder(page.hasMore)
      setHasNewer(false)
      stickRef.current = true
      requestAnimationFrame(() => {
        const list = listRef.current
        if (list) list.scrollTop = list.scrollHeight
      })
    } catch (error) {
      toast(error?.message || 'Could not load the latest messages', 'error')
    }
  }

  const send = async (text, kind = 'text') => {
    if (!text || !token) return false
    const tempId = `pending-${Date.now()}`
    const pending = { id: tempId, sender: me, kind, body: text, createdAt: new Date().toISOString(), pending: true }
    stickRef.current = true
    setMessages((current) => [...(current ?? []), pending])
    try {
      const data = await sendRoomMessage(token, text, { kind })
      setMessages((current) =>
        mergeSorted(
          (current ?? []).filter((message) => message.id !== tempId),
          [data.message]
        )
      )
      return true
    } catch (error) {
      setMessages((current) => (current ?? []).filter((message) => message.id !== tempId))
      // A token the server no longer honours is dropped, and the sign-in button comes back
      if (isChatUnauthorized(error)) clearChatToken(me)
      else toast(error?.message || 'Could not send the message', 'error')
      if (error?.status === 403) onModerated()
      return false
    }
  }

  const moderate = async (payload, done) => {
    try {
      const result = await moderateChat(token, payload)
      done?.(result)
      onModerated()
    } catch (error) {
      toast(error?.message || 'Moderation action failed', 'error')
    }
  }

  const showJump = hasNewer || !atBottom

  return (
    <>
      <div className={styles.room} ref={listRef} onScroll={onScroll}>
        <div className={styles.room__content} ref={contentRef}>
          {messages === null ? (
            <div className={styles.room__notice}>Loading…</div>
          ) : (
            <>
              {hasOlder && (
                <div className={styles.room__notice}>{isPaging ? 'Loading earlier messages…' : 'Scroll up for earlier messages'}</div>
              )}
              {messages.length === 0 && (
                <EmptyState icon={ChatCircleIcon} align="center" size="sm" className={styles.room__empty}>
                  Nobody has said anything yet
                </EmptyState>
              )}
              {groupRuns(messages, openedAtId).map((run) => (
                <ChatRun
                  key={run.key}
                  run={run}
                  me={me}
                  chatMe={chatMe}
                  dividerRef={run.divider ? dividerRef : null}
                  onModerate={moderate}
                  onRemoved={(id) => applyRemoved([id])}
                />
              ))}
              {hasNewer && (
                <div className={styles.room__notice}>{isPaging ? 'Loading newer messages…' : 'Scroll down for newer messages'}</div>
              )}
            </>
          )}
        </div>
      </div>

      {showJump && messages?.length > 0 && (
        <button type="button" className={styles.jump} onClick={jumpToLatest}>
          <ArrowDownIcon size={14} weight="bold" />
          Latest
        </button>
      )}

      {!me ? (
        <div className={styles.gate}>
          <span className={styles.gate__text}>Connect a wallet to join in</span>
          <button type="button" className={styles.gate__button} onClick={onConnect}>
            Connect
          </button>
        </div>
      ) : !token ? (
        <div className={styles.gate}>
          <span className={styles.gate__text}>One signature lets you post for a week</span>
          <button type="button" className={styles.gate__button} onClick={onSignIn} disabled={isSigningIn}>
            {isSigningIn ? 'Waiting for your wallet…' : 'Sign in to chat'}
          </button>
        </div>
      ) : chatMe?.bannedUntil ? (
        <div className={styles.gate}>
          <span className={styles.gate__text}>
            You are banned until {stampDate.format(new Date(chatMe.bannedUntil))}
            {chatMe.banReason ? ` · ${chatMe.banReason}` : ''}
          </span>
        </div>
      ) : (
        <Composer onSend={send} viewer={me} />
      )}
    </>
  )
}

function ChatRun({ run, me, chatMe, dividerRef, onModerate, onRemoved }) {
  const mine = sameAddress(run.sender, me)
  const first = run.messages[0]
  const isModerator = first.senderRole === 'moderator'

  return (
    <>
      {run.stamped && <div className={styles.stamp}>{first.pending ? 'Now' : stampDate.format(new Date(parseTime(first.createdAt)))}</div>}
      {dividerRef && (
        <div className={styles.divider} ref={dividerRef} role="separator" aria-label="New messages">
          <span>New messages</span>
        </div>
      )}
      <section className={clsx(styles.run, mine ? styles['run--mine'] : styles['run--theirs'])}>
        {/* The face column spans the whole run and sticks to the bottom of the scroll area, so
            it stays in view however long the run is */}
        {!mine && (
          <div className={styles.run__face}>
            <Profile creator={run.sender} variant="imageOnly" size={28} hoverCard={false} fingerprint={false} />
          </div>
        )}
        <div className={styles.run__stack}>
          {!mine && (
            <div className={styles.run__name}>
              <Profile
                creator={run.sender}
                variant="fullWithoutTime"
                size={16}
                hoverCard={false}
                fingerprint={false}
                className={styles.run__profile}
              />
              {isModerator && (
                <span className={styles.run__mod} title="Moderator">
                  <ShieldCheckIcon size={12} weight="fill" />
                  Mod
                </span>
              )}
            </div>
          )}
          {run.messages.map((message) => (
            <ChatLine
              key={message.id}
              message={message}
              mine={mine}
              me={me}
              chatMe={chatMe}
              isModerator={isModerator}
              onModerate={onModerate}
              onRemoved={onRemoved}
            />
          ))}
        </div>
      </section>
    </>
  )
}

function ChatLine({ message, mine, me, chatMe, isModerator, onModerate, onRemoved }) {
  const canAct = Boolean(chatMe?.canModerate) && !mine && !message.pending
  const when = message.pending ? 'Sending…' : toRelativeTime(message.createdAt)

  return (
    <div className={clsx(styles.line, message.pending && styles['line--pending'])} data-line-id={message.id}>
      {message.kind === 'gif' ? (
        // A Giphy CDN URL straight from the picker: the optimizer would only re-fetch it
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.line__gif} src={message.body} alt="GIF" loading="lazy" title={when} />
      ) : (
        <p className={styles.bubble} title={when}>
          {splitChatText(message.body).map((part, index) =>
            part.type === 'link' ? (
              <a key={index} href={part.value} target="_blank" rel="nofollow noopener noreferrer" className={styles.bubble__link}>
                {part.value}
              </a>
            ) : part.type === 'mention' ? (
              <Link
                key={index}
                href={`/${part.address}`}
                className={clsx(styles.bubble__mention, sameAddress(part.address, me) && styles['bubble__mention--me'])}
              >
                @{part.label}
              </Link>
            ) : (
              <span key={index}>{part.value}</span>
            )
          )}
        </p>
      )}
      {canAct && (
        <NativePopover
          placement="bottom-end"
          className={styles.menu}
          trigger={
            <button type="button" className={styles.line__menuButton} aria-label="Moderate this message">
              <DotsThreeIcon size={18} weight="bold" />
            </button>
          }
        >
          {({ close }) => (
            <div className={styles.menu__list}>
              <button
                type="button"
                className={styles.menu__item}
                onClick={() => {
                  close()
                  onModerate({ action: 'delete', messageId: message.id }, () => onRemoved(message.id))
                }}
              >
                Remove message
              </button>
              {BAN_CHOICES.map((days) => (
                <button
                  key={days}
                  type="button"
                  className={styles.menu__item}
                  onClick={() => {
                    close()
                    onModerate({ action: 'ban', wallet: message.sender, days }, () => toast(`Banned for ${days} day${days > 1 ? 's' : ''}`))
                  }}
                >
                  Ban for {days} day{days > 1 ? 's' : ''}
                </button>
              ))}
              <button
                type="button"
                className={styles.menu__item}
                onClick={() => {
                  close()
                  onModerate({ action: 'unban', wallet: message.sender }, () => toast('Ban lifted'))
                }}
              >
                Lift ban
              </button>
              {chatMe?.isAdmin && (
                <button
                  type="button"
                  className={clsx(styles.menu__item, styles['menu__item--admin'])}
                  onClick={() => {
                    close()
                    onModerate({ action: isModerator ? 'demote' : 'promote', wallet: message.sender }, () =>
                      toast(isModerator ? 'Moderator role removed' : 'Made a moderator')
                    )
                  }}
                >
                  {isModerator ? 'Remove moderator' : 'Make moderator'}
                </button>
              )}
            </div>
          )}
        </NativePopover>
      )}
    </div>
  )
}

function Composer({ onSend, viewer }) {
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const inputRef = useRef(null)
  const gifPickerRef = useRef(null)
  const mentionPickerRef = useRef(null)
  // The `@query` under the caret, when there is one; the picker is open exactly then
  const [mention, setMention] = useState(null)
  // Picked people, by the label they show as, so the draft stays readable and the wire format
  // is only written at send time
  const mentionsRef = useRef(new Map())

  const syncMention = (value, caret) => {
    const found = MENTION_QUERY_PATTERN.exec(value.slice(0, caret))
    if (!found) {
      setMention(null)
      return
    }
    const rect = inputRef.current?.getBoundingClientRect()
    setMention((current) => (current?.query === found[2] ? current : { query: found[2], caretRect: rect ?? null }))
  }

  const insertMention = (suggestion) => {
    const input = inputRef.current
    const caret = input?.selectionStart ?? draft.length
    const found = MENTION_QUERY_PATTERN.exec(draft.slice(0, caret))
    setMention(null)
    if (!found) return
    const label = mentionLabel(suggestion.username || suggestion.name || suggestion.ensName, suggestion.address)
    mentionsRef.current.set(label, suggestion.address)
    const start = caret - found[2].length - 1
    setDraft(`${draft.slice(0, start)}@${label} ${draft.slice(caret)}`)
    requestAnimationFrame(() => {
      if (!input) return
      input.focus()
      const at = start + label.length + 2
      input.setSelectionRange(at, at)
    })
  }

  // Every @label still in the text becomes the same link a post would carry
  const toWire = (text) => {
    let out = text
    for (const [label, address] of mentionsRef.current) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      out = out.replace(new RegExp(`(^|[^\\w])@${escaped}(?![\\w])`, 'g'), (_, lead) => `${lead}${mentionMarkdown(label, address)}`)
    }
    return out
  }

  const submit = async () => {
    const text = draft.trim()
    if (!text || isSending) return
    setIsSending(true)
    setDraft('')
    setMention(null)
    const sent = await onSend(toWire(text), 'text')
    if (sent) mentionsRef.current.clear()
    else setDraft(text)
    setIsSending(false)
    inputRef.current?.focus()
  }

  const insertEmoji = (glyph) => {
    const input = inputRef.current
    const start = input?.selectionStart ?? draft.length
    const end = input?.selectionEnd ?? draft.length
    const next = draft.slice(0, start) + glyph + draft.slice(end)
    setDraft(next)
    requestAnimationFrame(() => {
      if (!input) return
      input.focus()
      input.setSelectionRange(start + glyph.length, start + glyph.length)
    })
  }

  const hasDraft = draft.trim().length > 0

  return (
    <form
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className={styles.composer__pill}>
        <div className={styles.composer__tool}>
          <EmojiPicker onSelect={insertEmoji} />
        </div>
        <textarea
          ref={inputRef}
          className={styles.composer__input}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            syncMention(event.target.value, event.target.selectionStart ?? event.target.value.length)
          }}
          onKeyUp={(event) => {
            if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
              syncMention(event.target.value, event.target.selectionStart ?? event.target.value.length)
            }
          }}
          onBlur={() => setMention(null)}
          onKeyDown={(event) => {
            if (mentionPickerRef.current?.handleKeyDown(event)) return
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
          placeholder="Message…"
          rows={1}
          maxLength={BODY_MAX_CHARS}
          aria-label="Message"
        />
        {hasDraft ? (
          <button
            type="submit"
            className={clsx(styles.composer__tool, styles['composer__tool--send'])}
            disabled={isSending}
            aria-label="Send"
          >
            <PaperPlaneRightIcon size={20} weight="fill" />
          </button>
        ) : (
          <button
            type="button"
            className={styles.composer__tool}
            onClick={() => gifPickerRef.current?.open()}
            title="GIF"
            aria-label="Send a GIF"
          >
            <GifIcon size={22} />
          </button>
        )}
      </div>
      <MentionPicker
        ref={mentionPickerRef}
        query={mention?.query ?? ''}
        caretRect={mention?.caretRect ?? null}
        viewer={viewer ?? null}
        onPick={insertMention}
        onDismiss={() => setMention(null)}
      />
      <GifPicker ref={gifPickerRef} onSelect={(gif) => onSend(gif.full.url, 'gif')} />
    </form>
  )
}

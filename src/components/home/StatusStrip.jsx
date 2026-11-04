'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { Rise } from 'cube-motion/react'
import { CaretLeftIcon, CaretRightIcon, XIcon } from '@phosphor-icons/react'
import useRailScroll from '@/hooks/useRailScroll'
import { useActiveWallet } from '@/hooks/useActiveWallet'
import { profileFallbackFromRow, useProfile } from '@/hooks/useProfile'
import { usePostStore } from '@/stores/usePostStore'
import { getStatuses } from '@/lib/api'
import { isEvmAddress, sameAddress, shortAddress } from '@/lib/address'
import Avatar from '@/components/ui/Avatar'
import DialogSheet from '@/components/ui/DialogSheet'
import StatusEditorSheet, { describeStatus } from '@/components/status/StatusEditorSheet'
import styles from './StatusStrip.module.scss'

const STRIP_SIZE = 20

const fetchOwnStatus = async (address) => {
  const response = await fetch(`/api/v1/users/status?address=${encodeURIComponent(address)}`, { cache: 'no-store' })
  const body = await response.json()
  if (!response.ok || !body.success) throw new Error(body.error || 'Could not load status')
  return body.data
}

// Stamped with the fetch time so the rings are computed from one clock, outside render, and with
// what the viewer had seen at that moment, which the order is taken from (see StatusStrip)
const fetchStrip = async ([, viewer]) => {
  const response = await getStatuses(1, STRIP_SIZE, null, viewer, { following: true })
  return { list: response?.data ?? [], fetchedAt: Date.now(), seen: readSeen(viewer), viewer }
}

/** Share of the status's lifetime still left, 0–1; a status that never clears stays full. */
const remainingShare = (status, now) => {
  if (!status?.expires_at || !status.period_hours) return 1
  const left = status.expires_at * 1000 - now
  return Math.min(1, Math.max(0, left / (status.period_hours * 3600_000)))
}

const displayName = (status) => status.display_name || (status.username ? `@${status.username}` : shortAddress(status.wallet_address))

/* Which statuses this viewer has opened, on this device: `{ [viewer]: { [wallet]: updated_at } }`.
   A status counts as seen only at the version that was opened, so a new one from the same wallet
   is unseen again. Capped so the list cannot grow without end. */
const SEEN_KEY = 'hup:status-seen'
const SEEN_LIMIT = 300

const readAllSeen = () => {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {}
  } catch {
    return {}
  }
}

const readSeen = (viewer) => (viewer ? readAllSeen()[viewer.toLowerCase()] ?? {} : {})

const markSeen = (viewer, status) => {
  try {
    const all = readAllSeen()
    const mine = { ...(all[viewer.toLowerCase()] ?? {}), [status.wallet_address.toLowerCase()]: Number(status.updated_at) }
    // Keep the most recently updated entries when over the cap
    all[viewer.toLowerCase()] = Object.fromEntries(Object.entries(mine).sort((a, b) => b[1] - a[1]).slice(0, SEEN_LIMIT))
    localStorage.setItem(SEEN_KEY, JSON.stringify(all))
  } catch {
    // Storage blocked: everything simply stays unseen
  }
}

const isSeen = (status, seen) => Number(seen[status.wallet_address.toLowerCase()]) >= Number(status.updated_at)

/** A followed wallet's picture with its avatar decorations — from the same profile read (and
    cache) the feed's bylines use, so the strip costs no request a byline has not already made.
    The picture is the profile's, not the row's: `users.profileImage` can trail a Universal
    Profile that changed its picture onchain, so the row only stands in until the read lands. */
const StatusAvatar = ({ status }) => {
  const { profile } = useProfile(status.wallet_address, profileFallbackFromRow(status))
  return <Avatar className={styles.strip__avatar} src={profile?.profileImage ?? status.profile_image} size={52} decorations={profile?.decorations} />
}

/**
 * A row of avatars over the For you feed, each with its owner's status in a bubble above it —
 * the bubble the profile page shows over the avatar, at feed scale. The viewer's own slot comes
 * first and opens the status editor; anyone else's opens a sheet with the whole status.
 * Only wallets the viewer follows are shown; the Status tab is where everyone is. Signed out
 * there is no one to follow, so the strip stays hidden.
 *
 * Ordered the way Instagram orders stories: statuses the viewer has not opened yet come first,
 * newest first, and opened ones drop behind them with a grey ring. The order is taken when the
 * strip loads, so opening one greys its ring but does not reshuffle the row under the viewer's
 * finger; it moves back on the next load.
 */
export default function StatusStrip() {
  const { address, isConnected, kind } = useActiveWallet()
  const viewer = isConnected && kind === 'evm' && isEvmAddress(address) ? address : null
  const feedRefreshNonce = usePostStore((state) => state.feedRefreshNonce)
  const { profile } = useProfile(viewer)
  const editorRef = useRef(null)
  const viewerRef = useRef(null)
  const trackRef = useRef(null)
  const [selected, setSelected] = useState(null)
  // Already cached by the strip avatar that was tapped, so the sheet opens on the live picture
  const { profile: selectedProfile } = useProfile(selected?.wallet_address, profileFallbackFromRow(selected))
  const [openCount, setOpenCount] = useState(0)
  // Bumped when a status is opened, so its ring greys at once
  const [seenVersion, setSeenVersion] = useState(0)

  /* A Home tap bumps feedRefreshNonce, which is a new key with no data yet; without keeping the
     last answer the strip unmounted for the length of the refetch and popped back in. The kept
     answer is only used for the wallet it was fetched for, so a wallet switch never shows the
     previous wallet's follows. */
  const { data: lastStrip, mutate: mutateStrip } = useSWR(viewer ? ['status-strip', viewer, feedRefreshNonce] : null, fetchStrip, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
    keepPreviousData: true,
  })
  const strip = lastStrip && sameAddress(lastStrip.viewer, viewer) ? lastStrip : null
  const { data: ownStatus, mutate: mutateOwn } = useSWR(viewer ? ['own-status', viewer] : null, ([, wallet]) => fetchOwnStatus(wallet), {
    revalidateOnFocus: false,
  })

  /* The list re-keys on a Home tap by itself; the viewer's own status and the scroll position
     don't, so refresh those here too and bring the row back to its first slot */
  const lastNonceRef = useRef(feedRefreshNonce)
  useEffect(() => {
    if (feedRefreshNonce === lastNonceRef.current) return
    lastNonceRef.current = feedRefreshNonce
    if (viewer) mutateOwn()
    trackRef.current?.scrollTo({ left: 0, behavior: 'smooth' })
  }, [feedRefreshNonce, viewer, mutateOwn])

  const { canScrollLeft, canScrollRight, scrollByPage } = useRailScroll(trackRef, [strip])

  const now = strip?.fetchedAt ?? 0
  // The order uses what was seen when the strip loaded; the rings use what is seen now, re-read
  // on each render (`seenVersion` is what re-renders after an opening)
  const seen = seenVersion >= 0 ? readSeen(viewer) : {}
  const others = useMemo(() => {
    const seenAtLoad = strip?.seen ?? {}
    return (strip?.list ?? [])
      .filter((status) => !sameAddress(status.wallet_address, viewer))
      .sort((a, b) => isSeen(a, seenAtLoad) - isSeen(b, seenAtLoad) || Number(b.updated_at) - Number(a.updated_at))
  }, [strip, viewer])

  // Signed out (or on a Solana wallet) there is no follow list to read
  if (!viewer || !strip) return null

  const openOwn = () => editorRef.current?.open()

  const openStatus = (status) => {
    markSeen(viewer, status)
    setSeenVersion((version) => version + 1)
    setSelected(status)
    setOpenCount((count) => count + 1)
    viewerRef.current?.open()
  }

  const handleSaved = (saved) => {
    mutateOwn(saved, { revalidate: false })
    mutateStrip()
  }

  const ownHasStatus = Boolean(ownStatus?.content)

  return (
    <section className={styles.strip} aria-label="Statuses">
      {/* Overlaid at the row's ends rather than in a header the strip doesn't have, and only
          where the row can still move that way */}
      {canScrollLeft && (
        <button type="button" className={clsx(styles.strip__arrow, styles['strip__arrow--left'])} aria-label="Scroll statuses left" onClick={() => scrollByPage(-1)}>
          <CaretLeftIcon size={16} weight="bold" aria-hidden="true" />
        </button>
      )}
      {canScrollRight && (
        <button type="button" className={clsx(styles.strip__arrow, styles['strip__arrow--right'])} aria-label="Scroll statuses right" onClick={() => scrollByPage(1)}>
          <CaretRightIcon size={16} weight="bold" aria-hidden="true" />
        </button>
      )}

      <ul ref={trackRef} className={styles.strip__track}>
        <li>
          <button type="button" className={styles.strip__item} onClick={openOwn} title={ownHasStatus ? describeStatus(ownStatus) : 'Share a status'}>
            <span className={clsx(styles.strip__bubble, !ownHasStatus && styles['strip__bubble--add'])}>
              <span className={styles.strip__text}>{ownHasStatus ? ownStatus.content : '+ Share'}</span>
            </span>
            <span className={clsx(styles.strip__ring, !ownHasStatus && styles['strip__ring--idle'])} style={{ '--status-left': ownHasStatus ? remainingShare(ownStatus, now) : 0 }}>
              <Avatar className={styles.strip__avatar} src={viewer ? profile?.profileImage : null} size={52} decorations={profile?.decorations} />
            </span>
            <span className={styles.strip__name}>You</span>
          </button>
        </li>

        {others.map((status) => (
          <li key={status.wallet_address}>
            <button type="button" className={styles.strip__item} onClick={() => openStatus(status)} title={describeStatus(status)}>
              <span className={styles.strip__bubble}>
                <span className={styles.strip__text}>{status.content}</span>
              </span>
              <span className={clsx(styles.strip__ring, isSeen(status, seen) && styles['strip__ring--seen'])} style={{ '--status-left': remainingShare(status, now) }}>
                <StatusAvatar status={status} />
              </span>
              <span className={styles.strip__name}>{displayName(status)}</span>
            </button>
          </li>
        ))}
      </ul>

      {viewer && <StatusEditorSheet ref={editorRef} status={ownStatus} profileImage={profile?.profileImage} onSaved={handleSaved} />}

      <DialogSheet
        ref={viewerRef}
        aria-label="Status"
        lightDismiss
        onCancel={(event) => event.stopPropagation()}
        onClose={(event) => event.stopPropagation()}
      >
        {selected && (
          // Keyed per opening so the entrance replays even when the same status is reopened
          <div key={openCount} className={styles.viewer}>
            <button type="button" className={styles.viewer__close} aria-label="Close" onClick={() => viewerRef.current?.close()}>
              <XIcon size={18} weight="bold" />
            </button>

            <Rise targets="children" className={styles.viewer__stage}>
              {/* The profile page's avatar-and-bubble, at sheet scale */}
              <div className={styles.viewer__figure}>
                <span className={styles.viewer__ring} style={{ '--status-left': remainingShare(selected, now) }}>
                  <Avatar className={styles.viewer__avatar} src={selectedProfile?.profileImage ?? selected.profile_image} size={150} />
                </span>
                <div className={styles.viewer__bubbleSlot}>
                  <Rise as="p" delay={260} className={styles.viewer__bubble}>
                    {selected.content}
                  </Rise>
                </div>
              </div>
              <strong className={styles.viewer__name}>{displayName(selected)}</strong>
              <span className={styles.viewer__meta}>{describeStatus(selected)}</span>
              <Link
                href={selected.username ? `/@${selected.username}` : `/${selected.wallet_address}`}
                className={styles.viewer__profile}
                onClick={() => viewerRef.current?.close()}
              >
                View profile
              </Link>
            </Rise>
          </div>
        )}
      </DialogSheet>
    </section>
  )
}

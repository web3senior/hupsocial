'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { Rise } from 'cube-motion/react'
import { XIcon } from '@phosphor-icons/react'
import { useActiveWallet } from '@/hooks/useActiveWallet'
import { useProfile } from '@/hooks/useProfile'
import { usePostStore } from '@/stores/usePostStore'
import { getStatuses } from '@/lib/api'
import { isEvmAddress, sameAddress, shortAddress } from '@/lib/address'
import { openConnect } from '@/lib/connectDialog'
import { toast } from '@/components/NextToast'
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

// Stamped with the fetch time so the rings are computed from one clock, outside render
const fetchStrip = async ([, viewer]) => {
  const response = await getStatuses(1, STRIP_SIZE, null, viewer)
  return { list: response?.data ?? [], fetchedAt: Date.now() }
}

/** Share of the status's lifetime still left, 0–1; a status that never clears stays full. */
const remainingShare = (status, now) => {
  if (!status?.expires_at || !status.period_hours) return 1
  const left = status.expires_at * 1000 - now
  return Math.min(1, Math.max(0, left / (status.period_hours * 3600_000)))
}

const displayName = (status) => status.display_name || (status.username ? `@${status.username}` : shortAddress(status.wallet_address))

/**
 * A row of avatars over the For you feed, each with its owner's status in a bubble above it —
 * the bubble the profile page shows over the avatar, at feed scale. The viewer's own slot comes
 * first and opens the status editor; anyone else's opens a sheet with the whole status.
 * Wallets the viewer follows come first (the API orders them). Renders nothing until there is
 * a status to show or a wallet that could share one.
 */
export default function StatusStrip() {
  const { address, isConnected, kind } = useActiveWallet()
  const viewer = isConnected && kind === 'evm' && isEvmAddress(address) ? address : null
  const feedRefreshNonce = usePostStore((state) => state.feedRefreshNonce)
  const { profile } = useProfile(viewer)
  const editorRef = useRef(null)
  const viewerRef = useRef(null)
  const [selected, setSelected] = useState(null)
  const [openCount, setOpenCount] = useState(0)

  const { data: strip, mutate: mutateStrip } = useSWR(['status-strip', viewer, feedRefreshNonce], fetchStrip, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  })
  const { data: ownStatus, mutate: mutateOwn } = useSWR(viewer ? ['own-status', viewer] : null, ([, wallet]) => fetchOwnStatus(wallet), {
    revalidateOnFocus: false,
  })

  const now = strip?.fetchedAt ?? 0
  const others = (strip?.list ?? []).filter((status) => !sameAddress(status.wallet_address, viewer))

  // Signed out on an empty strip there is nothing to read and no one to write
  if (!isConnected && others.length === 0) return null
  if (!strip) return null

  const openOwn = () => {
    if (!isConnected) {
      if (!openConnect()) toast('Please connect wallet', 'error')
      return
    }
    if (!viewer) {
      toast('Statuses are signed by EVM wallets', 'error')
      return
    }
    editorRef.current?.open()
  }

  const openStatus = (status) => {
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
      <ul className={styles.strip__track}>
        <li>
          <button type="button" className={styles.strip__item} onClick={openOwn} title={ownHasStatus ? describeStatus(ownStatus) : 'Share a status'}>
            <span className={clsx(styles.strip__bubble, !ownHasStatus && styles['strip__bubble--add'])}>
              <span className={styles.strip__text}>{ownHasStatus ? ownStatus.content : '+ Share'}</span>
            </span>
            <span className={clsx(styles.strip__ring, !ownHasStatus && styles['strip__ring--idle'])} style={{ '--status-left': ownHasStatus ? remainingShare(ownStatus, now) : 0 }}>
              <Avatar className={styles.strip__avatar} src={viewer ? profile?.profileImage : null} size={52} />
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
              <span className={styles.strip__ring} style={{ '--status-left': remainingShare(status, now) }}>
                <Avatar className={styles.strip__avatar} src={status.profile_image} size={52} />
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
                  <Avatar className={styles.viewer__avatar} src={selected.profile_image} size={150} />
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

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { useConnection } from 'wagmi'
import { BroadcastIcon, CurrencyCircleDollarIcon, VideoCameraSlashIcon } from '@phosphor-icons/react'
import { fetchChatMe } from '@/lib/chatApi'
import { sameAddress, shortAddress } from '@/lib/address'
import { openConnect } from '@/lib/connectDialog'
import { liveDuration, liveIsConfigured, viewersLabel } from '@/lib/live'
import { fetchLiveStatus, killLiveStream } from '@/lib/liveApi'
import { useChatToken } from '@/hooks/useChatToken'
import { toast } from '@/components/NextToast'
import { ContentSpinner } from '@/components/Loading'
import Profile from '@/components/Profile'
import CopyButton from '@/components/ui/CopyButton'
import EmptyState from '@/components/ui/EmptyState'
import LiveBadge from '@/components/ui/LiveBadge'
import LivePlayer from './LivePlayer'
import LiveTipDialog from './LiveTipDialog'
import styles from './LiveWatch.module.scss'

const STATUS_REFRESH_MS = 5000

export default function LiveWatch({ address, name, username }) {
  const { address: viewer, isConnected } = useConnection()
  const token = useChatToken(viewer)
  const [showTip, setShowTip] = useState(false)
  const [confirmingEnd, setConfirmingEnd] = useState(false)
  const [isEnding, setIsEnding] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const { data: status, error, isLoading, mutate } = useSWR(liveIsConfigured ? ['live-status', address] : null, () => fetchLiveStatus(address), {
    refreshInterval: STATUS_REFRESH_MS,
    keepPreviousData: true,
  })

  const { data: chatMe } = useSWR(token ? ['chat-me', token] : null, () => fetchChatMe(token), { revalidateOnFocus: false })

  const isLive = status?.status === 'live'
  const isOwn = sameAddress(viewer, address)
  const who = name || (username ? `@${username}` : shortAddress(address))
  const watchPath = `/live/${username ? `@${username}` : address}`

  useEffect(() => {
    if (!isLive) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [isLive])

  const openTip = () => {
    if (!isConnected) {
      if (!openConnect()) toast('Please connect wallet', 'error')
      return
    }
    setShowTip(true)
  }

  const endStream = async () => {
    if (!confirmingEnd) return setConfirmingEnd(true)
    setIsEnding(true)
    try {
      await killLiveStream(token, status.id)
      toast('Stream ended', 'success')
      mutate({ status: 'offline' }, { revalidate: false })
    } catch (killError) {
      toast(killError?.message || 'Could not end the stream', 'error')
    } finally {
      setIsEnding(false)
      setConfirmingEnd(false)
    }
  }

  if (!liveIsConfigured) {
    return (
      <EmptyState size="lg" align="center" icon={BroadcastIcon} as="div">
        Live streaming is not set up here yet.
      </EmptyState>
    )
  }

  if (isLoading && !status) return <ContentSpinner />

  if (!isLive) {
    return (
      <div className={styles.watch}>
        <Profile creator={address} variant="fullWithoutTime" />
        <EmptyState
          size="lg"
          align="center"
          icon={VideoCameraSlashIcon}
          as="div"
          action={
            isOwn ? (
              <Link href="/live/studio" className={styles.watch__button}>
                Go live
              </Link>
            ) : (
              <Link href="/live" className={styles.watch__button}>
                See who is live
              </Link>
            )
          }
        >
          {error && !status ? 'The stream status could not be loaded.' : `${who} is not live right now.`}
        </EmptyState>
      </div>
    )
  }

  return (
    <div className={styles.watch}>
      <LivePlayer key={status.id} streamId={status.id} title={status.title} />

      <h1 className={styles.watch__title}>{status.title}</h1>

      <p className={styles.watch__meta}>
        <LiveBadge />
        <span>{viewersLabel(status.viewers)}</span>
        <span className={styles.watch__duration}>{liveDuration(status.startedAt, now)}</span>
      </p>

      <div className={styles.watch__row}>
        <Profile creator={address} variant="fullWithoutTime" />

        <div className={styles.watch__actions}>
          <CopyButton value={watchPath} title="Copy link" variant="chip" label="Share" />
          {isOwn ? (
            <Link href="/live/studio" className={styles.watch__button}>
              Open studio
            </Link>
          ) : (
            <button type="button" className={styles.watch__button} onClick={openTip}>
              <CurrencyCircleDollarIcon size={16} weight="fill" aria-hidden="true" />
              Tip
            </button>
          )}
        </div>
      </div>

      {chatMe?.canModerate && !isOwn && (
        <p className={styles.watch__moderation}>
          <span>Moderator</span>
          <button
            type="button"
            className={clsx(styles.watch__button, styles['watch__button--danger'])}
            onClick={endStream}
            onBlur={() => setConfirmingEnd(false)}
            disabled={isEnding}
          >
            {isEnding ? 'Ending…' : confirmingEnd ? 'Press again to end it' : 'End this stream'}
          </button>
        </p>
      )}

      {showTip && <LiveTipDialog streamer={address} networkId={status.networkId} onClose={() => setShowTip(false)} />}
    </div>
  )
}

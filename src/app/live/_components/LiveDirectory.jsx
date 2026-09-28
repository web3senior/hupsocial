'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { BroadcastIcon, VideoCameraIcon } from '@phosphor-icons/react'
import { appChains } from '@/config/contracts'
import { liveIsConfigured, viewersLabel } from '@/lib/live'
import { fetchLiveStreams } from '@/lib/liveApi'
import { ContentSpinner } from '@/components/Loading'
import Profile from '@/components/Profile'
import EmptyState from '@/components/ui/EmptyState'
import LiveBadge from '@/components/ui/LiveBadge'
import styles from './LiveDirectory.module.scss'

const REFRESH_MS = 15_000

const chainName = (id) => appChains.find((chain) => chain.id === Number(id))?.name || ''

export default function LiveDirectory() {
  const { data: streams, isLoading, error } = useSWR(liveIsConfigured ? 'live-streams' : null, fetchLiveStreams, {
    refreshInterval: REFRESH_MS,
    keepPreviousData: true,
  })

  return (
    <div className={styles.directory}>
      <div className={styles.directory__toolbar}>
        <h1 className={styles.directory__heading}>Live now</h1>
        <Link href="/live/studio" className={styles.directory__goLive}>
          <VideoCameraIcon size={16} weight="fill" aria-hidden="true" />
          Go live
        </Link>
      </div>

      {!liveIsConfigured && (
        <EmptyState size="lg" align="center" icon={BroadcastIcon} as="div">
          Live streaming is not set up here yet.
        </EmptyState>
      )}

      {isLoading && <ContentSpinner />}

      {liveIsConfigured && !isLoading && error && !streams && (
        <EmptyState size="lg" align="center" icon={BroadcastIcon} as="div">
          The list of live streams could not be loaded.
        </EmptyState>
      )}

      {streams?.length === 0 && (
        <EmptyState size="lg" align="center" icon={BroadcastIcon} as="div">
          Nobody is live right now.
        </EmptyState>
      )}

      {streams?.length > 0 && (
        <ul className={styles.directory__list}>
          {streams.map((stream) => (
            <li key={stream.id} className={styles.directory__card}>
              <Profile creator={stream.wallet} variant="fullWithoutTime" hoverCard={false} />

              <Link href={`/live/${stream.wallet}`} className={styles.directory__title}>
                {stream.title}
              </Link>

              <p className={styles.directory__meta}>
                <LiveBadge />
                <span>{viewersLabel(stream.viewers)}</span>
                {chainName(stream.networkId) && <span className={styles.directory__network}>{chainName(stream.networkId)}</span>}
              </p>

              <Link href={`/live/${stream.wallet}`} className={styles.directory__watch}>
                Watch
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

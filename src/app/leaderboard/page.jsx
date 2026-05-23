'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWRInfinite from 'swr/infinite'
import { ArrowDown, Eye, Flame, Heart, Medal, MessageCircle, Repeat2, Trophy, Users } from 'lucide-react'
import PageTitle from '@/components/PageTitle'
import { is0GHash, resolve0GUrl } from '@/lib/storageHelper'
import styles from './page.module.scss'
import Profile from '@/components/Profile'

const DEFAULT_AVATAR = '/default-pfp.svg'
const PAGE_SIZE = 20

const PERIOD_OPTIONS = [
  { value: 'all', label: 'All time' },
  { value: '30d', label: '30D' },
  { value: '7d', label: '7D' },
]

const SORT_OPTIONS = [
  { value: 'score', label: 'Score' },
  { value: 'engagement', label: 'Engagement' },
  { value: 'posts', label: 'Posts' },
  { value: 'views', label: 'Views' },
]

const numberFormatter = new Intl.NumberFormat('en-US')
const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const EMPTY_STATS = {
  active_users: 0,
  root_posts: 0,
  comments: 0,
  likes: 0,
  views: 0,
}

const fetcher = async (url) => {
  const response = await fetch(url)
  const json = await response.json()

  if (!response.ok || !json.success) {
    throw new Error(json.error || 'Leaderboard failed to load')
  }

  return json
}

export default function LeaderboardPage() {
  const router = useRouter()
  const [period, setPeriod] = useState('all')
  const [sort, setSort] = useState('score')
  const [networkId, setNetworkId] = useState('all')

  const getKey = (pageIndex, previousPageData) => {
    if (previousPageData && !previousPageData.meta?.hasMore) return null

    const params = new URLSearchParams({
      page: String(pageIndex + 1),
      limit: String(PAGE_SIZE),
      period,
      sort,
    })

    if (networkId !== 'all') {
      params.set('network_id', networkId)
    }

    return `/api/v1/leaderboard?${params.toString()}`
  }

  const { data, error, isLoading, isValidating, size, setSize } = useSWRInfinite(getKey, fetcher, {
    persistSize: false,
    revalidateFirstPage: false,
  })

  const leaders = useMemo(() => data?.flatMap((pageData) => pageData.data || []) || [], [data])
  const meta = data?.[data.length - 1]?.meta || data?.[0]?.meta || { stats: EMPTY_STATS, networks: [] }
  const stats = meta?.stats || EMPTY_STATS
  const networks = meta?.networks || []
  const topLeaders = useMemo(() => leaders.slice(0, 3), [leaders])
  const hasMore = Boolean(meta?.hasMore)
  const isLoadingMore = isValidating && size > 1

  const openProfile = (walletAddress) => {
    if (!walletAddress) return
    router.push(`/${walletAddress}`)
  }

  return (
    <>
      <PageTitle name="Leaderboard" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="large">
          <header className={styles.header}>
            <div>
              <div className={styles.eyebrow}>
                <Trophy size={16} />
                <span>Hup Rankings</span>
              </div>
              <h2>Leaderboard</h2>
            </div>

            <div className={styles.filters} aria-label="Leaderboard filters">
              <div className={styles.segmented} role="group" aria-label="Time range">
                {PERIOD_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={period === option.value ? styles.activeSegment : ''}
                    onClick={() => setPeriod(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <label className={styles.selectLabel}>
                <span>Network</span>
                <select value={networkId} onChange={(event) => setNetworkId(event.target.value)}>
                  <option value="all">All networks</option>
                  {networks.map((network) => (
                    <option key={network.id} value={network.id}>
                      {network.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.selectLabel}>
                <span>Sort</span>
                <select value={sort} onChange={(event) => setSort(event.target.value)}>
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </header>

          <section className={styles.summaryGrid} aria-label="Leaderboard summary">
            <StatCard icon={Users} label="Users" value={stats.active_users} />
            <StatCard icon={Flame} label="Posts" value={stats.root_posts} />
            <StatCard icon={MessageCircle} label="Comments" value={stats.comments} />
            <StatCard icon={Heart} label="Likes" value={stats.likes} />
            <StatCard icon={Eye} label="Views" value={stats.views} />
          </section>

          {error && <p className={styles.errorState}>{error.message}</p>}

          {isLoading ? (
            <LeaderboardSkeleton />
          ) : leaders.length === 0 ? (
            <p className={styles.emptyState}>No ranked activity found.</p>
          ) : (
            <>
              <section className={styles.podium} aria-label="Top ranked users">
                {topLeaders.map((leader) => (
                  <button
                    key={leader.wallet_address}
                    type="button"
                    className={`${styles.podiumItem} ${getRankClass(leader.rank)}`}
                    onClick={() => openProfile(leader.wallet_address)}
                  >
                    <RankBadge rank={leader.rank} />
                    <Profile creator={leader.wallet_address} variant="imageOnly" />
                    <div className={styles.podiumIdentity}>
                      <strong>{leader.display_name}</strong>
                      <code>{formatWallet(leader.wallet_address)}</code>
                    </div>
                    <div className={styles.scoreBlock}>
                      <span>{numberFormatter.format(leader.score)}</span>
                      <small>score</small>
                    </div>
                  </button>
                ))}
              </section>

              <section className={styles.leaderList} aria-label="Leaderboard rows">
                {leaders.map((leader) => (
                  <button
                    key={`${leader.rank}-${leader.wallet_address}`}
                    type="button"
                    className={styles.leaderRow}
                    onClick={() => openProfile(leader.wallet_address)}
                  >
                    <span className={styles.rankNumber}>{leader.rank}</span>
                    <Profile creator={leader.wallet_address} variant="imageOnly" />
                    <span className={styles.identity}>
                      <strong>{leader.display_name}</strong>
                      <code>{formatWallet(leader.wallet_address)}</code>
                    </span>
                    <Metric icon={Flame} label="Posts" value={leader.root_posts} />
                    <Metric icon={MessageCircle} label="Comments" value={leader.comments_made} />
                    <Metric icon={Heart} label="Likes" value={leader.likes_received} />
                    <Metric icon={Repeat2} label="Reposts" value={leader.reposts_made} />
                    <Metric icon={Eye} label="Views" value={leader.views_received} />
                    <span className={styles.rowScore}>{compactFormatter.format(leader.score)}</span>
                  </button>
                ))}
              </section>

              {hasMore && (
                <div className={styles.loadMoreWrap}>
                  <button type="button" className={styles.loadMore} onClick={() => setSize(size + 1)} disabled={isLoadingMore}>
                    <ArrowDown size={16} />
                    <span>{isLoadingMore ? 'Loading' : 'Load more'}</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className={styles.statCard}>
      <Icon size={16} />
      <span>{label}</span>
      <strong>{compactFormatter.format(value)}</strong>
    </div>
  )
}

function Metric({ icon: Icon, label, value }) {
  return (
    <span className={styles.metric} title={label}>
      <Icon size={15} />
      <span>{compactFormatter.format(value)}</span>
    </span>
  )
}

function RankBadge({ rank }) {
  return (
    <span className={styles.rankBadge}>
      {rank <= 3 ? <Medal size={16} /> : null}
      <span>#{rank}</span>
    </span>
  )
}

function LeaderboardSkeleton() {
  return (
    <div className={styles.skeletonList} aria-label="Loading leaderboard">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className={styles.skeletonRow}>
          <span />
          <div />
          <p />
        </div>
      ))}
    </div>
  )
}

function getRankClass(rank) {
  if (rank === 1) return styles.rankFirst
  if (rank === 2) return styles.rankSecond
  if (rank === 3) return styles.rankThird
  return ''
}

function formatWallet(wallet = '') {
  if (wallet.length <= 12) return wallet
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`
}

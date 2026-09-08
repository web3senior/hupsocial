'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWRInfinite from 'swr/infinite'
import {
  ArrowDownIcon,
  ChatCircleIcon,
  EyeIcon,
  FlameIcon,
  HandCoinsIcon,
  HashIcon,
  HeartIcon,
  PackageIcon,
  RepeatIcon,
  TrophyIcon,
  UsersIcon,
} from '@phosphor-icons/react'
import clsx from 'clsx'
import PageTitle from '@/components/PageTitle'
import styles from './page.module.scss'
import Profile from '@/components/Profile'
import { useProfile } from '@/hooks/useProfile'
const DEFAULT_AVATAR = '/default-pfp.svg'
const PAGE_SIZE = 20
const PODIUM_AVATAR_SIZE = 48
const ROW_AVATAR_SIZE = 32

const RANK_CROWNS = {
  1: '/icons/1st.svg',
  2: '/icons/2nd.svg',
  3: '/icons/3rd.svg',
}

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
  { value: 'transactions', label: 'Transactions' },
  { value: 'followers', label: 'Followers' },
  { value: 'tips', label: 'Tips' },
]

const numberFormatter = new Intl.NumberFormat('en-US')
const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const EMPTY_STATS = {
  users: 0,
  root_posts: 0,
  comments: 0,
  likes: 0,
  views: 0,
  tips: 0,
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
            <StatCard icon={UsersIcon} label={period === 'all' ? 'Users' : 'New users'} value={stats.users} />
            <StatCard icon={FlameIcon} label="Posts" value={stats.root_posts} />
            <StatCard icon={ChatCircleIcon} label="Comments" value={stats.comments} />
            <StatCard icon={HeartIcon} label="Likes" value={stats.likes} />
            <StatCard icon={EyeIcon} label="Views" value={stats.views} />
            <StatCard icon={HandCoinsIcon} label="Tips" value={stats.tips} />
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
                    <CrownedProfile
                      rank={leader.rank}
                      wallet={leader.wallet_address}
                      size={PODIUM_AVATAR_SIZE}
                      className={styles.podiumProfile}
                    />
                    <div className={styles.scoreBlock}>
                      <span>{numberFormatter.format(leader.score)}</span>
                      <small>score</small>
                    </div>
                  </button>
                ))}
              </section>

              <section className={styles.leaderList} aria-label="Leaderboard rows">
                <div className={styles.leaderRowHeader}>
                  <span>#</span>
                  <span>Profiles</span>
                  <span>Posts</span>
                  <span>Comments</span>
                  <span>Likes</span>
                  <span>Reposts</span>
                  <span>Views</span>
                  <span>Tips</span>
                  <span>Transactions</span>
                  <span>Followers</span>
                  <span>Score</span>
                </div>
                {leaders.map((leader) => (
                  <button
                    key={`${leader.rank}-${leader.wallet_address}`}
                    type="button"
                    className={styles.leaderRow}
                    onClick={() => openProfile(leader.wallet_address)}
                  >
                    <span className={styles.rankNumber}>{leader.rank}</span>
                    <CrownedProfile
                      rank={leader.rank}
                      wallet={leader.wallet_address}
                      size={ROW_AVATAR_SIZE}
                      className={styles.avatar}
                    />

                    <Metric icon={FlameIcon} label="Posts" value={leader.root_posts} />
                    <Metric icon={ChatCircleIcon} label="Comments" value={leader.comments_made} />
                    <Metric icon={HeartIcon} label="Likes" value={leader.likes_received} />
                    <Metric icon={RepeatIcon} label="Reposts" value={leader.reposts_made} />
                    <Metric icon={EyeIcon} label="Views" value={leader.views_received} />
                    <Metric icon={HandCoinsIcon} label="Tips received" value={leader.tips_received} />
                    <Metric icon={PackageIcon} label="Transactions" value={leader.tx_count} />
                    <Metric icon={UsersIcon} label="Followers" value={leader.follower_count} />
                    <span className={styles.rowScore}>{compactFormatter.format(leader.score)}</span>
                  </button>
                ))}
              </section>

              {hasMore && (
                <div className={styles.loadMoreWrap}>
                  <button type="button" className={styles.loadMore} onClick={() => setSize(size + 1)} disabled={isLoadingMore}>
                    <ArrowDownIcon size={16} />
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

/*
 * The crown rides the avatar itself, so the badge alongside it carries the plain
 * number — two medals for one rank would only read as noise.
 */
function RankBadge({ rank }) {
  return (
    <span className={styles.rankBadge}>
      <span className={styles.rankNumber}>#{rank}</span>
    </span>
  )
}

/*
 * Profile.jsx stays the one identity renderer; the crown is an overlay anchored off the
 * avatar box it was handed, which is why the size travels as a variable rather than a guess.
 */
function CrownedProfile({ rank, wallet, size, className }) {
  const crownSrc = RANK_CROWNS[rank]

  return (
    <span
      className={clsx(styles.crowned, className)}
      style={{ '--crowned-avatar-size': `${size}px` }}
      data-rank={crownSrc ? rank : undefined}
    >
      {crownSrc && (
        <>
          <span className={styles.crowned__ring} aria-hidden="true" />
          <img className={styles.crowned__crown} src={crownSrc} alt="" aria-hidden="true" />
        </>
      )}
      <Profile creator={wallet} variant="fullWithoutTime" size={size} />
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
//   <WalletCard address={leader.wallet_address} />
// function WalletCard({ address }) {
//   const { profile, isLoading, isError } = useProfile(address)

//   if (isLoading) return <div>Loading account data...</div>
//   if (isError || !profile) return <div>Error loading profile</div>
// {console.log(profile)}
//   return (
//     <div className="wallet-card">
//       <h3>{profile.name}</h3>
//       <small>{formatWallet(profile.wallet)}</small>
//     </div>
//   )
// }

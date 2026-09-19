'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import useSWRInfinite from 'swr/infinite'
import {
  ArrowDownIcon,
  CalendarDotIcon,
  CalendarDotsIcon,
  ChatCircleIcon,
  EyeIcon,
  FlameIcon,
  HandCoinsIcon,
  HashIcon,
  HeartIcon,
  InfinityIcon,
  PackageIcon,
  RepeatIcon,
  SortAscendingIcon,
  StackIcon,
  TrophyIcon,
  UsersIcon,
} from '@phosphor-icons/react'
import { config } from '@/config/wagmi'
import { SOLANA_CHAINS } from '@/config/solana'
import PageTitle from '@/components/PageTitle'
import OptionPicker from '@/components/ui/OptionPicker'
import SegmentedControl from '@/components/ui/SegmentedControl'
import styles from './page.module.scss'
import Profile from '@/components/Profile'
import { useProfile } from '@/hooks/useProfile'
import { profilePath } from '@/lib/username'
const DEFAULT_AVATAR = '/default-pfp.svg'
const PAGE_SIZE = 20
// Half of this hangs over the card it sits on — .podium reserves the gutter for it
const PODIUM_AVATAR_SIZE = 72
const ROW_AVATAR_SIZE = 32

const PERIOD_OPTIONS = [
  { value: 'all', label: 'All time', icon: InfinityIcon },
  { value: '30d', label: 'Last 30 days', icon: CalendarDotsIcon },
  { value: '7d', label: 'Last 7 days', icon: CalendarDotIcon },
]

const SORT_OPTIONS = [
  { value: 'score', label: 'Score', icon: <TrophyIcon size={16} /> },
  { value: 'engagement', label: 'Engagement', icon: <HeartIcon size={16} /> },
  { value: 'posts', label: 'Posts', icon: <FlameIcon size={16} /> },
  { value: 'views', label: 'Views', icon: <EyeIcon size={16} /> },
  { value: 'transactions', label: 'Transactions', icon: <PackageIcon size={16} /> },
  { value: 'followers', label: 'Followers', icon: <UsersIcon size={16} /> },
  { value: 'tips', label: 'Tips', icon: <HandCoinsIcon size={16} /> },
]

// The chain's own picture, the way the header's switcher shows it. Solana's clusters ride in
// the same config the switcher reads, so a chain added there arrives here with its art.
const CHAIN_ART = new Map([...config.chains, ...SOLANA_CHAINS].map((chain) => [String(chain.id), chain.iconUrl]))

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
  // Ids travel as strings so the 'all' sentinel and a chain id compare the same way
  const networkOptions = useMemo(
    () => [
      { value: 'all', label: 'All networks', icon: <StackIcon size={16} /> },
      ...networks.map((network) => {
        const art = CHAIN_ART.get(String(network.id))
        return {
          value: String(network.id),
          label: network.name,
          // Same fallback the header's switcher uses when a chain ships no art of its own
          icon: art ? <img src={art} alt="" /> : <span className={styles.chainInitial}>{network.name.charAt(0)}</span>,
        }
      }),
    ],
    [networks],
  )
  const hasMore = Boolean(meta?.hasMore)
  const isLoadingMore = isValidating && size > 1

  return (
    <>
      <PageTitle name="Leaderboard" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="large">
          <header className={styles.header}>
            <div className={styles.filters} role="group" aria-label="Leaderboard filters">
              <SegmentedControl options={PERIOD_OPTIONS} value={period} onChange={setPeriod} label="Period" iconOnly />

              <div className={styles.filterGroup}>
                <OptionPicker
                  ariaLabel="Network"
                  value={networkId}
                  onChange={setNetworkId}
                  options={networkOptions}
                  triggerClassName={styles.filterTrigger}
                  panelClassName={styles.filterPanel}
                />
              </div>

              <div className={styles.filterGroup}>
                <OptionPicker
                  ariaLabel="Sort by"
                  value={sort}
                  onChange={setSort}
                  options={SORT_OPTIONS}
                  triggerClassName={styles.filterTrigger}
                  panelClassName={styles.filterPanel}
                  placement="bottom-end"
                />
              </div>
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
                  <div key={leader.wallet_address} className={styles.podiumItem} data-rank={leader.rank}>
                    <Link
                      href={profilePath(leader.wallet_address, leader.username)}
                      className={styles.cardLink}
                      aria-label={`Open the profile ranked #${leader.rank}`}
                    />
                    <Profile
                      creator={leader.wallet_address}
                      variant="stacked"
                      size={PODIUM_AVATAR_SIZE}
                      className={styles.podiumProfile}
                    />
                    <div className={styles.scoreBlock}>
                      <span>{numberFormatter.format(leader.score)}</span>
                      <small>score</small>
                    </div>
                    <span className={styles.podiumRank}>Rank {leader.rank}</span>
                  </div>
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
                  <span>TXs</span>
                  <span>Followers</span>
                  <span>Score</span>
                </div>
                {leaders.map((leader) => (
                  <div key={`${leader.rank}-${leader.wallet_address}`} className={styles.leaderRow}>
                    <Link
                      href={profilePath(leader.wallet_address, leader.username)}
                      className={styles.cardLink}
                      aria-label={`Open the profile ranked #${leader.rank}`}
                    />
                    <span className={styles.rankNumber} data-rank={leader.rank}>
                      {leader.rank}
                    </span>
                    <Profile
                      creator={leader.wallet_address}
                      variant="fullWithoutTime"
                      size={ROW_AVATAR_SIZE}
                      className={styles.avatar}
                    />

                    <Metric icon={FlameIcon} label="Posts" value={leader.root_posts} />
                    <Metric icon={ChatCircleIcon} label="Comments" value={leader.comments_made} />
                    <Metric icon={HeartIcon} label="Likes" value={leader.likes_received} title={likesTitle(leader)} />
                    <Metric icon={RepeatIcon} label="Reposts" value={leader.reposts_made} />
                    <Metric icon={EyeIcon} label="Views" value={leader.views_received} />
                    <Metric icon={HandCoinsIcon} label="Tips received" value={leader.tips_received} />
                    <Metric icon={PackageIcon} label="Transactions" value={leader.tx_count} />
                    <Metric icon={UsersIcon} label="Followers" value={leader.follower_count} />
                    <span className={styles.rowScore}>{compactFormatter.format(leader.score)}</span>
                  </div>
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

function Metric({ icon: Icon, label, value, title }) {
  return (
    <span className={styles.metric} title={title || label}>
      <Icon size={15} />
      <span>{compactFormatter.format(value)}</span>
    </span>
  )
}

/* The column shows likes received, but every neighbouring column is an action the member took, so
   the hover spells out which side of the like each number is. */
function likesTitle(leader) {
  return `Likes received: ${numberFormatter.format(leader.likes_received)} — Likes given: ${numberFormatter.format(leader.likes_given)}`
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

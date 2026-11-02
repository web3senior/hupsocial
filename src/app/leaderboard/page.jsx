'use client'

import { Spinner } from '@/components/Loading'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import useSWRInfinite from 'swr/infinite'
import {
  CalendarDotIcon,
  ArrowUpRightIcon,
  CaretUpIcon,
  CaretDownIcon,
  CalendarDotsIcon,
  ChatCircleIcon,
  EyeIcon,
  FlameIcon,
  HandCoinsIcon,
  HeartIcon,
  InfinityIcon,
  PackageIcon,
  RepeatIcon,
  SealCheckIcon,
  StackIcon,
  TrendUpIcon,
  TrophyIcon,
  UsersIcon,
} from '@phosphor-icons/react'
import clsx from 'clsx'
import { Rise } from 'cube-motion/react'
import { config } from '@/config/wagmi'
import { SOLANA_CHAINS } from '@/config/solana'
import PageTitle from '@/components/PageTitle'
import OptionPicker from '@/components/ui/OptionPicker'
import SegmentedControl from '@/components/ui/SegmentedControl'
import Shimmer from '@/components/ui/Shimmer'
import styles from './page.module.scss'
import Profile from '@/components/Profile'
import { useProfile } from '@/hooks/useProfile'
import { profilePath } from '@/lib/username'
const DEFAULT_AVATAR = '/default-pfp.svg'
const PAGE_SIZE = 20
const ROW_AVATAR_SIZE = 44
const RANKING_METRICS = {
  score: { field: 'score', label: 'Total score' },
  engagement: { field: 'likes_received', label: 'Likes received' },
  posts: { field: 'total_posts', label: 'Posts & comments' },
  views: { field: 'views_received', label: 'Views received' },
  tips: { field: 'tips_received', label: 'Tips received' },
  transactions: { field: 'tx_count', label: 'Transactions' },
  followers: { field: 'follower_count', label: 'Followers' },
}
// Shiny pixels that drift down past each podium picture: x across the field (%), size (px),
// how long one fall takes and how far into it the pixel starts (s). Fixed so server and
// client render the same field.
const PODIUM_SPARKLES = [
  { x: 6, size: 2, duration: 7.5, delay: 0 },
  { x: 16, size: 1.5, duration: 9, delay: 3.2 },
  { x: 27, size: 2, duration: 8, delay: 5.6 },
  { x: 38, size: 1.5, duration: 10, delay: 1.4 },
  { x: 50, size: 2.5, duration: 8.5, delay: 6.8 },
  { x: 61, size: 1.5, duration: 9.5, delay: 2.3 },
  { x: 72, size: 2, duration: 7, delay: 4.4 },
  { x: 83, size: 1.5, duration: 10.5, delay: 0.8 },
  { x: 94, size: 2, duration: 8, delay: 7.4 },
]

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
// "+9,575": the sign rides on every non-zero change so a quiet day reads as a plain 0
const deltaFormatter = new Intl.NumberFormat('en-US', { signDisplay: 'exceptZero' })
// The networks card shows this many chain icons, then a "+N" chip for the rest
const NETWORK_ICON_LIMIT = 5

const EMPTY_STATS = {
  users: 0,
  root_posts: 0,
  comments: 0,
  likes: 0,
  views: 0,
  tips: 0,
  premium: 0,
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
  const rankingMetric = RANKING_METRICS[sort]

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
  const dayStats = meta?.stats_24h || EMPTY_STATS
  const networks = meta?.networks || []
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

  // Fetch the next page as the reader nears the end. The callback lives in a ref so the observer
  // never re-attaches just because it closed over fresher state; re-observing after each page
  // lands re-fires it when the sentinel is still on screen.
  const sentinelRef = useRef(null)
  const loadMoreRef = useRef(null)
  useEffect(() => {
    loadMoreRef.current = () => {
      if (!isValidating) setSize(size + 1)
    }
  }, [isValidating, setSize, size])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMoreRef.current?.()
      },
      { rootMargin: '400px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, leaders.length])

  return (
    <>
      <PageTitle name="Leaderboard" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="xlarge">
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

          <section className={styles.summary} aria-label="Leaderboard summary">
            <StatCard icon={UsersIcon} label={period === 'all' ? 'Users' : 'New users'} value={stats.users} delta={dayStats.users} />
            <StatCard icon={FlameIcon} label="Posts" value={stats.root_posts} delta={dayStats.root_posts} />
            <StatCard icon={ChatCircleIcon} label="Comments" value={stats.comments} delta={dayStats.comments} />
            <StatCard icon={HeartIcon} label="Likes" value={stats.likes} delta={dayStats.likes} />
            <StatCard icon={EyeIcon} label="Views" value={stats.views} delta={dayStats.views} />
            <StatCard icon={HandCoinsIcon} label="Tips" value={stats.tips} delta={dayStats.tips} />
            <StatCard icon={SealCheckIcon} label="Premium" value={stats.premium} delta={dayStats.premium} />
            <NetworksCard networks={networks} />
          </section>

          {error && <p className={styles.errorState}>{error.message}</p>}

          {isLoading ? (
            <LeaderboardSkeleton />
          ) : leaders.length === 0 ? (
            <p className={styles.emptyState}>No ranked activity found.</p>
          ) : (
            <>
              <header className={styles.rankingsHeader}>
                <div>
                  <h2>Community rankings</h2>
                  <p>{PERIOD_OPTIONS.find((option) => option.value === period)?.label} · Ranked by {SORT_OPTIONS.find((option) => option.value === sort)?.label.toLowerCase()}</p>
                </div>
                <span>{numberFormatter.format(leaders.length)} profiles loaded</span>
              </header>
              <section className={styles.leaderGrid} aria-label="Ranked profiles">
                {leaders.map((leader) => (
                  <Rise as="article" key={leader.wallet_address} className={clsx(styles.leaderCard, leader.rank <= 3 && styles['leaderCard--winner'])} data-rank={leader.rank}>
                    <Link
                      href={profilePath(leader.wallet_address, leader.username)}
                      className={styles.leaderCard__link}
                      aria-label={`Open the profile ranked #${leader.rank}`}
                    />
                    <div className={styles.leaderCard__heading}>
                      <span className={styles.leaderCard__rank} data-rank={leader.rank}>#{leader.rank}</span>
                      <span className={styles.leaderCard__score}>
                        <TrophyIcon size={16} aria-hidden="true" />
                        {leader.rank <= 3 ? 'Top 3' : 'Ranked member'}
                      </span>
                    </div>
                    <div className={styles.leaderCard__identity}>
                      {leader.rank <= 3 && (
                        <span className={styles.sparkles} style={{ '--podium-avatar': `${ROW_AVATAR_SIZE}px` }} aria-hidden="true">
                          {PODIUM_SPARKLES.map((sparkle) => (
                            <i
                              key={sparkle.x}
                              className={styles.sparkles__pixel}
                              style={{
                                '--sparkle-x': `${sparkle.x}%`,
                                '--sparkle-size': `${sparkle.size}px`,
                                '--sparkle-drift': `${(sparkle.x % 3 - 1) * 12}px`,
                                animationDuration: `${sparkle.duration}s`,
                                animationDelay: `-${sparkle.delay}s`,
                              }}
                            />
                          ))}
                        </span>
                      )}
                      <Profile
                        creator={leader.wallet_address}
                        variant="fullWithoutTime"
                        size={ROW_AVATAR_SIZE}
                        className={styles.leaderCard__profile}
                      />
                    </div>
                    <div className={styles.leaderCard__highlight}>
                      <span>{rankingMetric.label}</span>
                      <strong title={numberFormatter.format(leader[rankingMetric.field])}>{compactFormatter.format(leader[rankingMetric.field])}</strong>
                      {sort !== 'score' && <small>{compactFormatter.format(leader.score)} total score</small>}
                    </div>
                    <MetricRail rank={leader.rank}>
                      <Metric icon={FlameIcon} label="Posts" value={leader.root_posts} active={sort === 'posts'} />
                      <Metric icon={ChatCircleIcon} label="Comments" value={leader.comments_made} active={sort === 'posts'} />
                      <Metric icon={HeartIcon} label="Likes" value={leader.likes_received} title={likesTitle(leader)} active={sort === 'engagement'} />
                      <Metric icon={RepeatIcon} label="Reposts" value={leader.reposts_made} active={sort === 'engagement'} />
                      <Metric icon={EyeIcon} label="Views" value={leader.views_received} active={sort === 'views'} />
                      <Metric icon={HandCoinsIcon} label="Tips received" value={leader.tips_received} active={sort === 'tips'} />
                      <Metric icon={PackageIcon} label="Transactions" value={leader.tx_count} active={sort === 'transactions'} />
                      <Metric icon={UsersIcon} label="Followers" value={leader.follower_count} active={sort === 'followers'} />
                    </MetricRail>
                    <span className={styles.leaderCard__action} aria-hidden="true">View profile <ArrowUpRightIcon size={16} /></span>
                  </Rise>
                ))}
              </section>

              {hasMore && (
                <div ref={sentinelRef} className={styles.loadMoreWrap} aria-live="polite">
                  {isLoadingMore && <Spinner size={20} />}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

function StatCard({ icon: Icon, label, value, delta }) {
  const isUp = delta > 0

  return (
    <div className={styles.statCard}>
      <span className={styles.statCard__label}>
        <Icon size={18} />
        {label}
      </span>
      <strong className={styles.statCard__value}>{numberFormatter.format(value)}</strong>
      <span className={styles.statCard__delta}>
        {isUp && <TrendUpIcon size={16} />}
        <span className={clsx(styles.statCard__change, isUp && styles['statCard__change--up'])}>
          {deltaFormatter.format(delta)}
        </span>
        in 24h
      </span>
    </div>
  )
}

/* Every chain the board ranks, drawn with the same art the network filter uses */
function NetworksCard({ networks }) {
  const shown = networks.slice(0, NETWORK_ICON_LIMIT)
  const hidden = networks.length - shown.length

  return (
    <div className={styles.statCard}>
      <span className={styles.statCard__label}>
        <StackIcon size={18} />
        Networks
      </span>
      <strong className={styles.statCard__value}>{numberFormatter.format(networks.length)}</strong>
      <ul className={styles.chainStack} aria-label="Ranked networks">
        {shown.map((network) => {
          const art = CHAIN_ART.get(String(network.id))
          return (
            <li key={network.id} className={styles.chainStack__item} title={network.name}>
              {art ? <img src={art} alt={network.name} /> : <span className={styles.chainInitial}>{network.name.charAt(0)}</span>}
            </li>
          )
        })}
        {hidden > 0 && <li className={clsx(styles.chainStack__item, styles['chainStack__item--more'])}>+{hidden}</li>}
      </ul>
    </div>
  )
}

function MetricRail({ children, rank }) {
  const railRef = useRef(null)
  const [canScrollUp, setCanScrollUp] = useState(false)
  const [canScrollDown, setCanScrollDown] = useState(false)

  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    const measure = () => {
      setCanScrollUp(rail.scrollTop > 1)
      setCanScrollDown(rail.scrollTop + rail.clientHeight < rail.scrollHeight - 1)
    }
    measure()
    rail.addEventListener('scroll', measure, { passive: true })
    const observer = new ResizeObserver(measure)
    observer.observe(rail)
    return () => {
      rail.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [])

  const scrollRow = (direction) => {
    const rail = railRef.current
    if (!rail || rail.children.length < 2) return
    const rowHeight = rail.children[1].getBoundingClientRect().top - rail.children[0].getBoundingClientRect().top
    rail.scrollBy({
      top: direction * rowHeight,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    })
  }

  return (
    <div className={styles.metricRail}>
      <div className={styles.metricRail__header}>
        <span>Activity</span>
        {(canScrollUp || canScrollDown) && (
          <div className={styles.metricRail__arrows}>
            <button type="button" className={styles.metricRail__arrow} aria-label={`Show previous stats row for rank ${rank}`} disabled={!canScrollUp} onClick={() => scrollRow(-1)}>
              <CaretUpIcon size={12} aria-hidden="true" />
            </button>
            <button type="button" className={styles.metricRail__arrow} aria-label={`Show next stats row for rank ${rank}`} disabled={!canScrollDown} onClick={() => scrollRow(1)}>
              <CaretDownIcon size={12} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      <dl ref={railRef} className={styles.metricRail__list} data-scroll-up={canScrollUp} data-scroll-down={canScrollDown} tabIndex={0} aria-label={`Activity stats for rank ${rank}`}>
        {children}
      </dl>
    </div>
  )
}

function Metric({ icon: Icon, label, value, title, active }) {
  return (
    <div className={clsx(styles.leaderCard__metric, active && styles['leaderCard__metric--active'])} title={title || `${label}: ${numberFormatter.format(value)}`}>
      <dt><Icon size={15} aria-hidden="true" />{label}</dt>
      <dd>{compactFormatter.format(value)}</dd>
    </div>
  )
}

/* Keep received and given likes explicit in the metric's tooltip. */
function likesTitle(leader) {
  return `Likes received: ${numberFormatter.format(leader.likes_received)} — Likes given: ${numberFormatter.format(leader.likes_given)}`
}

function LeaderboardSkeleton() {
  return (
    <div className={styles.leaderGrid} aria-label="Loading leaderboard" aria-busy="true">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className={clsx(styles.leaderCard, styles['leaderCard--loading'])} aria-hidden="true">
          <Shimmer className={styles.leaderCard__placeholder} style={{ width: '35%', height: 20 }} />
          <Shimmer className={styles.leaderCard__placeholder} style={{ width: '75%', height: ROW_AVATAR_SIZE }} />
          <Shimmer className={styles.leaderCard__placeholder} style={{ height: 65 }} />
          <div className={styles.metricRail__list}>
            {Array.from({ length: 8 }).map((_, metricIndex) => <Shimmer key={metricIndex} className={styles.leaderCard__placeholder} style={{ height: 48 }} />)}
          </div>
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

'use client'

import { useId, useMemo, useState } from 'react'
import Link from 'next/link'
import PersonalScoreCard from './PersonalScoreCard'
import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
import { useConnection } from 'wagmi'

import {
  ChatCircleIcon,
  CrownSimpleIcon,
  EyeIcon,
  FlameIcon,
  FunnelIcon,
  HandCoinsIcon,
  HeartIcon,
  PackageIcon,
  PencilSimpleIcon,
  RepeatIcon,
  RocketLaunchIcon,
  ShieldCheckIcon,
  SparkleIcon,
  TrophyIcon,
  UsersIcon,
} from '@phosphor-icons/react'
import clsx from 'clsx'
import { Rise } from 'cube-motion/react'
import Profile from '@/components/Profile'
import useAchievementCatalog from '@/hooks/useAchievementCatalog'
import { ACHIEVEMENT_BONUSES, ACHIEVEMENT_GRANTED_CAP, SOCIAL_SCORE_WEIGHTS, STANDINGS_SORTS, achievementBonusLabel, currentSeason, followerPoints } from '@/config/points'
import AchievementEmblem from '@/components/achievements/AchievementEmblem'
import { Spinner } from '@/components/Loading'
import NativePopover from '@/components/ui/NativePopover'
import Shimmer from '@/components/ui/Shimmer'
import styles from './SeasonBoard.module.scss'

const PAGE_SIZE = 20
const AVATAR_SIZE = 40

const numberFormatter = new Intl.NumberFormat('en-US')
const compactFormatter = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

const fetcher = async (url) => {
  const response = await fetch(url)
  const json = await response.json()
  if (!response.ok || !json.success) throw new Error(json.error || 'Points failed to load')
  return json
}

// Total ranks every wallet by its all-time leaderboard score (/api/v1/leaderboard); the season
// ranks by season points (/api/v1/points), the list the $HUP airdrop is cut from
const PERIODS = [
  { value: 'total', label: 'Total' },
  { value: 'season', label: currentSeason().name },
]

// The all-time board's own sort keys (lib/leaderboard.js SORTS) and the row field each one reads
const TOTAL_SORTS = [
  { value: 'score', label: 'Total score', field: 'score' },
  { value: 'posts', label: 'Posts & comments', field: 'total_posts' },
  { value: 'engagement', label: 'Likes received', field: 'likes_received' },
  { value: 'views', label: 'Views', field: 'views_received' },
  { value: 'tips', label: 'Tips received', field: 'tips_received' },
  { value: 'followers', label: 'Followers', field: 'follower_count' },
  { value: 'transactions', label: 'Transactions', field: 'tx_count' },
]

const SORTS_BY_PERIOD = { total: TOTAL_SORTS, season: STANDINGS_SORTS }

// Not ranked is an answer for the single-wallet read, not a failure
const fetchOwn = async (url) => {
  const response = await fetch(url)
  if (response.status === 404) return null
  return fetcher(url)
}

/** The API request for one page of the standings, or one wallet's own row. */
const standingsUrl = ({ period, sort, networkId, page, wallet }) => {
  const params = new URLSearchParams({ limit: wallet ? '1' : String(PAGE_SIZE), sort })
  if (networkId !== 'all') params.set('network_id', networkId)
  if (period === 'total') {
    params.set('period', 'all')
    if (wallet) params.set('wallet_address', wallet)
    else params.set('page', String(page))
    return `/api/v1/leaderboard?${params}`
  }
  if (wallet) params.set('wallet', wallet)
  else params.set('page', String(page))
  return `/api/v1/points?${params}`
}

/** A season's SQL datetime (UTC) as a readable date. */
const seasonDate = (value) => dateFormatter.format(new Date(`${value.replace(' ', 'T')}Z`))

/**
 * The points season inside /leaderboard: the ranking the $HUP airdrop is cut from (lib/points.js),
 * with its rules and the connected wallet's own standing. One page for both rankings, so a member
 * never compares two boards that disagree.
 */
export default function SeasonBoard({ networks = [] }) {
  const { address } = useConnection()
  const [period, setPeriod] = useState('total')
  const [sort, setSort] = useState('score')
  const [networkId, setNetworkId] = useState('all')
  const [showMine, setShowMine] = useState(false)
  const sorts = SORTS_BY_PERIOD[period]
  const order = sorts.find((option) => option.value === sort) ?? sorts[0]
  const defaultSort = sorts[0].value
  const networkName = networks.find((network) => String(network.id) === networkId)?.name
  const activeFilters = Number(period !== 'total') + Number(order.value !== defaultSort) + Number(networkId !== 'all') + Number(showMine && Boolean(address))

  // Each period has its own sort keys, so switching starts it on its own default
  const choosePeriod = (next) => {
    setPeriod(next)
    setSort(SORTS_BY_PERIOD[next][0].value)
  }
  const reset = () => {
    choosePeriod('total')
    setNetworkId('all')
    setShowMine(false)
  }

  const getKey = (pageIndex, previous) => {
    if (previous && !previous.nextPage) return null
    return standingsUrl({ period, sort: order.value, networkId, page: pageIndex + 1 })
  }
  const { data, error, isLoading, isValidating, size, setSize } = useSWRInfinite(getKey, fetcher, { revalidateFirstPage: false })
  // Your own row, in the order being read, pinned above the list
  const { data: own } = useSWR(showMine && address ? standingsUrl({ period, sort: order.value, networkId, wallet: address }) : null, fetchOwn)
  const mine = period === 'total' ? own?.data : own?.meta?.mine
  const mineRanked = period === 'total' ? Boolean(mine?.rank) : Boolean(mine?.position)
  // The season and its rules, for the points cards, whichever period the list shows
  const { data: seasonInfo } = useSWR('/api/v1/points?limit=1', fetcher)
  const meta = seasonInfo?.meta

  const standings = useMemo(() => data?.flatMap((page) => page.data || []) || [], [data])
  const summary = [PERIODS.find((option) => option.value === period).label, `ranked by ${order.label.toLowerCase()}`, networkName].filter(Boolean).join(' · ')

  const hasMore = Boolean(data?.at(-1)?.nextPage)

  return (
    <div className={styles.season}>
      {/* The season's totals ride on the connected wallet's card; what the season is and how it
          pays leads the points cards below, so the page opens on the reader, not a banner. */}
      <PersonalScoreCard />

      {meta && <HowToEarn season={meta.season} rules={meta.rules} />}

      <section className={styles.season__board} aria-label="Standings">
        <header className={styles.season__toolbar}>
          <h2 className={styles.season__heading}>
            <TrophyIcon size={20} aria-hidden="true" />
            Standings
          </h2>
          <div className={styles.filters} role="group" aria-label="Standings filters">
            <span className={styles.filters__summary}>{summary}</span>
            <NativePopover
              placement="bottom-end"
              className={styles.filtersPanel}
              trigger={
                <button
                  type="button"
                  className={clsx(styles.filters__button, activeFilters > 0 && styles['filters__button--active'])}
                  aria-label={`Standings filters${activeFilters > 0 ? `, ${activeFilters} active` : ''}`}
                  title="Period, ranking, network and your position"
                >
                  <FunnelIcon size={16} aria-hidden="true" />
                  {activeFilters > 0 && <span className={styles.filters__badge}>{activeFilters}</span>}
                </button>
              }
            >
              <div className={styles.filtersPanel__body}>
                <h3 className={styles.filtersPanel__title}>Standings filters</h3>
                <div className={styles.filtersPanel__field}>
                  <label htmlFor="standingsPeriod">Period</label>
                  <select id="standingsPeriod" value={period} onChange={(event) => choosePeriod(event.target.value)}>
                    {PERIODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <p className={styles.filtersPanel__hint}>
                    {period === 'total' ? 'All-time activity on Hup. The $HUP airdrop is split by season points.' : 'Season points: the ranking the $HUP airdrop is split by.'}
                  </p>
                </div>
                <div className={styles.filtersPanel__field}>
                  <label htmlFor="standingsSort">Rank by</label>
                  <select id="standingsSort" value={order.value} onChange={(event) => setSort(event.target.value)}>
                    {sorts.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                <div className={styles.filtersPanel__field}>
                  <label htmlFor="standingsNetwork">Network</label>
                  <select id="standingsNetwork" value={networkId} onChange={(event) => setNetworkId(event.target.value)}>
                    <option value="all">All networks</option>
                    {networks.map((network) => <option key={network.id} value={String(network.id)}>{network.name}</option>)}
                  </select>
                  {period === 'season' && networkId !== 'all' && (
                    <p className={styles.filtersPanel__hint}>Points earned on this network only. Launches and achievement bonuses count across networks, so they are left out here.</p>
                  )}
                </div>
                <label className={styles.filtersPanel__check}>
                  <input type="checkbox" checked={showMine} disabled={!address} onChange={(event) => setShowMine(event.target.checked)} />
                  Show my position
                </label>
                {!address && <p className={styles.filtersPanel__hint}>Connect a wallet to pin your own row.</p>}
                {activeFilters > 0 && (
                  <button type="button" className={styles.filtersPanel__reset} onClick={reset}>
                    Reset filters
                  </button>
                )}
              </div>
            </NativePopover>
          </div>
        </header>
        {showMine && address && own && (
          mineRanked ? (
            <ol className={clsx(styles.board, styles['board--pinned'])} aria-label="Your position">
              <StandingRow row={mine} order={order} period={period} pinned />
            </ol>
          ) : (
            <p className={styles.season__pinned}>You&rsquo;re not ranked here yet.</p>
          )
        )}
        {error ? (
          <p className={styles.season__empty}>Standings failed to load. Try again in a moment.</p>
        ) : isLoading ? (
          <BoardSkeleton />
        ) : standings.length === 0 ? (
          <p className={styles.season__empty}>No ranked wallets here yet. Post, like or comment to be the first.</p>
        ) : (
          <ol className={styles.board}>
            {standings.map((row) => <StandingRow key={row.wallet_address} row={row} order={order} period={period} />)}
          </ol>
        )}
        {hasMore && (
          <div className={styles.season__more}>
            <button type="button" className={styles.season__button} disabled={isValidating} onClick={() => setSize(size + 1)}>
              {isValidating ? <Spinner size={16} /> : 'Show more'}
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * One wallet on the standings, from either period. The number is its place in the order being
 * read; crowns belong to each period's main order (total score, season points), so only show there.
 */
function StandingRow({ row, order, period, pinned = false }) {
  const season = period === 'season'
  const byPoints = order.value === SORTS_BY_PERIOD[period][0].value
  const place = row.position ?? row.rank
  const value = row[order.field] ?? 0
  const breakdown = season
    ? `${numberFormatter.format(row.social_points ?? 0)} social + ${numberFormatter.format(row.launchpad_points ?? 0)} launchpad + ${numberFormatter.format(row.achievement_points ?? 0)} achievement points`
    : `${numberFormatter.format(row.score ?? 0)} total score`
  return (
    <Rise
      as="li"
      className={clsx(styles.board__row, byPoints && place <= 3 && styles['board__row--crowned'], pinned && styles['board__row--mine'])}
      data-rank={byPoints ? place : undefined}
    >
      <span className={styles.board__rank} data-rank={byPoints ? place : undefined} title={season && !byPoints ? `Season rank #${row.rank}` : undefined}>
        {byPoints && place <= 3 && <CrownSimpleIcon size={16} weight="fill" aria-label={`Top ${place}`} />}#{place}
      </span>
      {/* Profile links to the account itself */}
      <div className={styles.board__who}>
        {pinned && <span className={styles.board__you}>You</span>}
        <Profile creator={row.wallet_address} variant="fullWithoutTime" size={AVATAR_SIZE} className={styles.board__profile} />
        <AchievementMarks held={row.achievements} bonuses={row.achievement_bonuses} />
      </div>
      <ul className={styles.board__activity} aria-label={season ? 'Season activity' : 'All-time activity'}>
        {/* The old leaderboard card's eight figures, then coins launched as the launchpad's own group */}
        <Activity icon={FlameIcon} label="Posts" value={row.root_posts} />
        <Activity icon={ChatCircleIcon} label="Comments" value={row.comments_made} />
        <Activity icon={HeartIcon} label="Likes received" value={row.likes_received} />
        <Activity icon={RepeatIcon} label="Reposts" value={row.reposts_made} />
        <Activity icon={EyeIcon} label="Views" value={row.views_received} />
        <Activity icon={HandCoinsIcon} label="Tips received" value={row.tips_received} />
        <Activity icon={PackageIcon} label="Transactions" value={row.tx_count} />
        <Activity icon={UsersIcon} label="Followers" value={row.follower_count} />
        {/* Coins launched, the launchpad's own group — season points count them, the all-time board does not */}
        {season && <Activity icon={RocketLaunchIcon} label="Coins launched" value={row.launches} group="launchpad" />}
      </ul>
      <strong
        className={styles.board__points}
        title={breakdown}
      >
        {compactFormatter.format(value)}
        {!byPoints && <small className={styles.board__unit}>{order.label}</small>}
      </strong>
    </Rise>
  )
}

/** One season figure on a standings row; `group` starts a new group of figures. */
function Activity({ icon: Icon, label, value = 0, group }) {
  return (
    <li data-group={group} title={`${label}: ${numberFormatter.format(value)}`}>
      <Icon size={14} aria-hidden="true" />
      {compactFormatter.format(value)}
    </li>
  )
}

/* What each thing you do is worth, read from the same weights the scoring uses (config/points.js).
   Every action you take also earns `perAction`, so it is folded into those rows: the number shown
   is the whole of what one action adds. */
const W = SOCIAL_SCORE_WEIGHTS
const EARN_GROUPS = [
  {
    icon: PencilSimpleIcon,
    title: 'Create',
    rows: [
      ['Post', W.post + W.perAction],
      ['Comment', W.comment + W.perAction],
      ['Repost', W.repost + W.perAction],
    ],
  },
  {
    icon: HeartIcon,
    title: 'Get noticed',
    rows: [
      ['Tip received', W.tipReceived],
      ['Like received', W.likeReceived],
      ['View', W.view],
      ['25 followers', followerPoints(25)],
      ['100 followers', followerPoints(100)],
    ],
    note: 'Followers who have posted or liked count, on a curve that flattens as you grow.',
  },
  {
    icon: HandCoinsIcon,
    title: 'Give back',
    rows: [
      ['Tip sent', W.tipGiven + W.perAction],
      ['Like sent', W.likeGiven + W.perAction],
    ],
  },
]

const bonusWhen = (rule) => {
  if (rule.seasons) return `Season ${rule.seasons.join(', ')} only`
  if (rule.nextSeason) return 'paid the season after'
  if (rule.granted) return 'given by the team'
  return null
}

/** One card of point values. */
function EarnCard({ icon: Icon, title, rows, note, children }) {
  return (
    <div className={styles.earn__item}>
      <Icon size={22} className={styles.earn__icon} aria-hidden="true" />
      <h4 className={styles.earn__title}>{title}</h4>
      <ul className={styles.earn__rows}>
        {rows.map(({ label, value, sub }) => (
          <li key={label} className={styles.earn__row}>
            <span>
              {label}
              {sub && <span className={styles.earn__sub}> · {sub}</span>}
            </span>
            <strong className={styles.earn__value}>+{numberFormatter.format(value)}</strong>
          </li>
        ))}
      </ul>
      {note && <p className={styles.earn__note}>{note}</p>}
      {children}
    </div>
  )
}

/** How points add up this season — every number comes from the scoring config, never typed here. */
function HowToEarn({ season, rules }) {
  const headingId = useId()
  const { achievementById } = useAchievementCatalog()
  const toRows = (rows) => rows.map(([label, value]) => ({ label, value }))
  // A hidden achievement drops out of the catalog, so it is not advertised here either.
  const bonuses = Object.entries(ACHIEVEMENT_BONUSES)
    .map(([id, rule]) => ({ item: achievementById(id), rule }))
    .filter(({ item }) => item)
    .map(({ item, rule }) => ({ label: item.name, value: rule.points, sub: bonusWhen(rule) }))

  return (
    <section className={styles.earn} aria-labelledby={headingId}>
      <header className={styles.earn__header}>
        <span className={styles.earn__eyebrow}>
          <SparkleIcon size={16} aria-hidden="true" />
          {season.name} · live since {seasonDate(season.startsAt)}
        </span>
        <h3 id={headingId} className={styles.earn__heading}>How points add up</h3>
        <p className={styles.earn__lede}>
          Everything below counts toward {season.name}. When it ends, the $HUP airdrop is split by points.{' '}
          <Link href="/token" className={styles.earn__link}>About $HUP</Link>
        </p>
      </header>
      <div className={styles.earn__grid}>
        {EARN_GROUPS.map((group) => (
          <EarnCard key={group.title} icon={group.icon} title={group.title} rows={toRows(group.rows)} note={group.note} />
        ))}
        {bonuses.length > 0 && (
          <EarnCard icon={CrownSimpleIcon} title="Achievement bonuses" rows={bonuses}
            note={`Team-given bonuses add at most +${numberFormatter.format(ACHIEVEMENT_GRANTED_CAP)} a season.`}>
            <Link href="/achievements" className={styles.earn__link}>See achievements</Link>
          </EarnCard>
        )}
      </div>
      <p className={styles.earn__foot}>
        <ShieldCheckIcon size={16} aria-hidden="true" />
        <span>
          Points count once your profile is {rules.minAccountAgeDays} days old. Bonuses only add to wallets that earn points this
          season. Final airdrop rules are published after the snapshot.
        </span>
      </p>
    </section>
  )
}

function BoardSkeleton() {
  return (
    <div className={styles.board} aria-busy="true" aria-label="Loading standings">
      {Array.from({ length: 6 }).map((_, index) => (
        <Shimmer key={index} style={{ height: 64 }} />
      ))}
    </div>
  )
}

/**
 * The achievements a standings row holds, as small square marks beside the name: the ones that paid
 * an airdrop bonus this season carry the accent, and every mark's tooltip says what it is worth.
 */
function AchievementMarks({ held = [], bonuses = [] }) {
  const { achievementById } = useAchievementCatalog()
  const marks = held.map((id) => achievementById(id)).filter(Boolean)
  if (!marks.length) return null
  const paid = new Map(bonuses.map((bonus) => [bonus.id, bonus.points]))
  return (
    <ul className={styles.board__marks} aria-label="Achievements">
      {marks.map((item) => {
        const points = paid.get(item.id)
        const bonus = achievementBonusLabel(item.id)
        const label = points ? `${item.name}: +${points} points this season` : bonus ? `${item.name}: ${bonus}` : `${item.name}: no airdrop points`
        return (
          <li key={item.id} className={clsx(styles.board__mark, points && styles['board__mark--bonus'])}>
            <AchievementEmblem item={item} size={26} label={label} />
          </li>
        )
      })}
    </ul>
  )
}

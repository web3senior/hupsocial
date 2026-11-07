'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { ChatCircleIcon, EyeIcon, FlameIcon, HandCoinsIcon, HeartIcon, RobotIcon, SealCheckIcon, StackIcon, TrendUpIcon, UsersIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import { config } from '@/config/wagmi'
import { SOLANA_CHAINS } from '@/config/solana'
import PageTitle from '@/components/PageTitle'
import styles from './page.module.scss'
import SeasonBoard from './_components/SeasonBoard'

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
// The strip's change line is narrow, so a big day reads "+12.4K"
const compactDeltaFormatter = new Intl.NumberFormat('en-US', { signDisplay: 'exceptZero', notation: 'compact', maximumFractionDigits: 1 })
// The networks card shows this many chain icons, then a "+N" chip for the rest
const NETWORK_ICON_LIMIT = 5

const EMPTY_STATS = {
  users: 0,
  agents: 0,
  root_posts: 0,
  comments: 0,
  likes: 0,
  views: 0,
  tips: 0,
  premium: 0,
}

// The platform's all-time numbers; one row is enough, since only the totals are read
const PLATFORM_URL = `/api/v1/leaderboard?${new URLSearchParams({ period: 'all', limit: '1' })}`

const fetcher = async (url) => {
  const response = await fetch(url)
  const json = await response.json()

  if (!response.ok || !json.success) {
    throw new Error(json.error || 'Leaderboard failed to load')
  }

  return json
}

/**
 * /leaderboard: the platform's numbers, then the points season — the one ranking the $HUP airdrop
 * is cut from (SeasonBoard). /points redirects here; an old ?period= link lands on the same page.
 */
export default function LeaderboardPage() {
  const { data } = useSWR(PLATFORM_URL, fetcher)
  const meta = data?.meta
  const stats = meta?.stats || EMPTY_STATS
  const dayStats = meta?.stats_24h || EMPTY_STATS
  const networks = meta?.networks || []

  return (
    <>
      <PageTitle name="Leaderboard" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="xlarge">
          <section className={styles.summary} aria-label="Platform summary">
            <StatCard
              icon={UsersIcon}
              label="Active users"
              value={stats.users}
              delta={dayStats.users}
              description="All-time unique wallets that participated on Hup. Connecting or reading alone does not count. The 24h change counts first-time participants."
            />
            <StatCard icon={RobotIcon} label="Agents" value={stats.agents} delta={dayStats.agents} href="/agents" />
            <StatCard icon={FlameIcon} label="Posts" value={stats.root_posts} delta={dayStats.root_posts} />
            <StatCard icon={ChatCircleIcon} label="Comments" value={stats.comments} delta={dayStats.comments} />
            <StatCard icon={HeartIcon} label="Likes" value={stats.likes} delta={dayStats.likes} />
            <StatCard icon={EyeIcon} label="Views" value={stats.views} delta={dayStats.views} />
            <StatCard icon={HandCoinsIcon} label="Tips" value={stats.tips} delta={dayStats.tips} />
            <StatCard icon={SealCheckIcon} label="Premium" value={stats.premium} delta={dayStats.premium} />
            <NetworksCard networks={networks} />
          </section>

          <SeasonBoard networks={networks} />
        </div>
      </div>
    </>
  )
}

function StatCard({ icon: Icon, label, value = 0, delta = 0, href, description }) {
  const isUp = delta > 0
  const Card = href ? Link : 'div'

  return (
    <Card
      className={styles.statCard}
      title={`${label}: ${numberFormatter.format(value)} (${delta === 0 ? 'no change' : deltaFormatter.format(delta)} in 24h)${description ? `. ${description}` : ''}`}
      {...(href ? { href } : {})}
    >
      <span className={styles.statCard__label}>
        <Icon size={14} aria-hidden="true" />
        {label}
      </span>
      <strong className={styles.statCard__value}>{value >= 10000 ? compactFormatter.format(value) : numberFormatter.format(value)}</strong>
      <span className={clsx(styles.statCard__delta, isUp && styles['statCard__delta--up'])}>
        {isUp && <TrendUpIcon size={12} aria-hidden="true" />}
        {delta === 0 ? '—' : compactDeltaFormatter.format(delta)}
        <span className={styles.statCard__period}>24h</span>
      </span>
    </Card>
  )
}

/* Every chain Hup has activity on */
function NetworksCard({ networks }) {
  const shown = networks.slice(0, NETWORK_ICON_LIMIT)
  const hidden = networks.length - shown.length

  return (
    <div className={styles.statCard}>
      <span className={styles.statCard__label}>
        <StackIcon size={14} aria-hidden="true" />
        Networks
      </span>
      <strong className={styles.statCard__value}>{numberFormatter.format(networks.length)}</strong>
      <ul className={styles.chainStack} aria-label="Networks">
        {shown.map((network) => {
          const art = CHAIN_ART.get(String(network.id))
          return (
            <li key={network.id} className={styles.chainStack__item} title={network.name}>
              {/* eslint-disable-next-line @next/next/no-img-element -- chain art is inline data/remote SVG of mixed sizes */}
              {art ? <img src={art} alt={network.name} /> : <span className={styles.chainInitial}>{network.name.charAt(0)}</span>}
            </li>
          )
        })}
        {hidden > 0 && <li className={clsx(styles.chainStack__item, styles['chainStack__item--more'])}>+{hidden}</li>}
      </ul>
    </div>
  )
}

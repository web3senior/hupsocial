'use client'

import useSWR from 'swr'
import { useState } from 'react'
import { useConnection } from 'wagmi'
import { ChartBarIcon, EyeIcon, HeartIcon, UsersIcon, WalletIcon } from '@phosphor-icons/react'
import PageTitle from '@/components/PageTitle'
import { ContentSpinner } from '@/components/Loading'
import { useClientMounted } from '@/hooks/useClientMount'
import InsightsPeriodPicker from './_components/InsightsPeriodPicker'
import Sparkline from './_components/Sparkline'
import TrendChart from './_components/TrendChart'
import BreakdownPieChart from './_components/BreakdownPieChart'
import TopPostsList from './_components/TopPostsList'
import styles from './page.module.scss'

const numberFormatter = new Intl.NumberFormat(undefined, { notation: 'compact' })

// Validated categorical palette (dataviz reference instance), in its fixed CVD-safe slot order.
const CATEGORICAL_COLORS = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834']

/* Assigns one hue per network across every breakdown on the page, in stable network_id order,
 * so the same network wears the same color in both pies regardless of its share in either. */
function buildNetworkColors(...breakdowns) {
  const ids = [...new Set(breakdowns.flat().map((slice) => slice.network_id))].sort((a, b) => (a > b ? 1 : -1))
  return new Map(ids.map((id, index) => [id, CATEGORICAL_COLORS[index]]))
}

const fetcher = async (url) => {
  const response = await fetch(url)
  const json = await response.json()
  if (!response.ok || !json.success) throw new Error(json.error || 'Insights failed to load')
  return json.data
}

function sumSeries(series, key) {
  return series?.reduce((total, point) => total + point[key], 0) || 0
}

const SPARK_POINTS = 12

/* Condenses a daily series into ~12 sparkline points: mean per bucket for per-day counts
 * (sum would zigzag on the uneven 2/3-day buckets a 30d period produces), last value per
 * bucket for the cumulative follower count. Short periods render as-is. */
function bucketSeries(series, key, mode) {
  if (!series?.length) return []
  if (series.length <= SPARK_POINTS) return series.map((point) => point[key])

  const values = []
  for (let i = 0; i < SPARK_POINTS; i++) {
    const start = Math.floor((i * series.length) / SPARK_POINTS)
    const end = Math.max(Math.floor(((i + 1) * series.length) / SPARK_POINTS), start + 1)
    const slice = series.slice(start, end)
    values.push(
      mode === 'last'
        ? slice[slice.length - 1][key]
        : slice.reduce((total, point) => total + point[key], 0) / slice.length,
    )
  }
  return values
}

export default function InsightsPage() {
  const mounted = useClientMounted()
  const { address, isConnected } = useConnection()
  const [period, setPeriod] = useState('30d')

  const { data, error, isLoading } = useSWR(
    isConnected && address ? `/api/v1/users/${address}/insights?period=${period}` : null,
    fetcher,
  )

  const networkColors = data ? buildNetworkColors(data.posts_by_network || [], data.engagement_by_network || []) : null

  /* Metric colors mirror the post-action hues (view → purple, like → --liked-color,
   * comment → indigo, bookmark-blue for followers) at the -500 step, which passes the
   * palette validator on both card surfaces where the -400 hover tints do not. Each
   * sparkline gradient starts at the metric hue and ends at a stop validated (six-checks
   * script) against both card surfaces, light and dark. */
  const statTiles = data
    ? [
        {
          label: 'Followers',
          value: data.follower_count,
          Icon: UsersIcon,
          color: 'var(--blue-500, #3b82f6)',
          spark: bucketSeries(data.follower_growth, 'count', 'last'),
          gradient: ['#3b82f6', '#0891b2'],
        },
        {
          label: 'Profile views',
          value: sumSeries(data.profile_views, 'count'),
          Icon: EyeIcon,
          color: 'var(--purple-500, #a855f7)',
          spark: bucketSeries(data.profile_views, 'count', 'mean'),
          gradient: ['#a855f7', '#ec4899'],
        },
        {
          label: 'Post views',
          value: sumSeries(data.reach, 'views'),
          Icon: ChartBarIcon,
          color: 'var(--purple-500, #a855f7)',
          spark: bucketSeries(data.reach, 'views', 'mean'),
          gradient: ['#6366f1', '#a855f7'],
        },
        {
          label: 'Likes received',
          value: sumSeries(data.reach, 'likes'),
          Icon: HeartIcon,
          color: 'var(--liked-color, #ff007a)',
          spark: bucketSeries(data.reach, 'likes', 'mean'),
          gradient: ['#ff007a', '#ea580c'],
        },
      ]
    : []

  return (
    <>
      <PageTitle name="Insights" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          {!mounted ? null : !isConnected ? (
            <div className={styles.emptyState}>
              <WalletIcon size={48} />
              <h3>Connect your wallet</h3>
              <p>Connect your wallet to see your Insights.</p>
            </div>
          ) : isLoading ? (
            <div className={styles.page__loading}>
              <ContentSpinner size="32px" />
            </div>
          ) : error ? (
            <div className={styles.emptyState}>
              <ChartBarIcon size={48} />
              <h3>Couldn&apos;t load Insights</h3>
              <p>{error.message}</p>
            </div>
          ) : (
            <>
              <div className={styles.page__header}>
                <h2 className={styles.page__headerTitle}>Insights</h2>
                <InsightsPeriodPicker value={period} onChange={setPeriod} />
              </div>

              <div className={styles.page__stats}>
                {statTiles.map(({ label, value, Icon, color, spark, gradient }) => (
                  <div key={label} className={styles.statTile} style={{ '--stat-tile-color': color }}>
                    <div className={styles.statTile__header}>
                      <span className={styles.statTile__badge} aria-hidden="true">
                        <Icon size={22} weight="fill" />
                      </span>
                      <Sparkline className={styles.statTile__spark} values={spark} from={gradient[0]} to={gradient[1]} />
                    </div>
                    <span className={styles.statTile__label}>{label}</span>
                    <span className={styles.statTile__value}>{numberFormatter.format(value)}</span>
                  </div>
                ))}
              </div>

              <h3 className={styles.page__sectionTitle}>Performance over time</h3>
              <div className={styles.page__charts}>
                <TrendChart
                  title="Follower growth"
                  data={data.follower_growth}
                  series={[{ key: 'count', label: 'Followers', color: 'var(--blue-500, #3b82f6)' }]}
                />
                <TrendChart
                  title="Profile views"
                  data={data.profile_views}
                  series={[{ key: 'count', label: 'Profile views', color: 'var(--purple-500, #a855f7)' }]}
                />
                <TrendChart
                  title="Post reach"
                  data={data.reach}
                  series={[
                    { key: 'views', label: 'Views', color: 'var(--purple-500, #a855f7)' },
                    { key: 'likes', label: 'Likes', color: 'var(--liked-color, #ff007a)' },
                    { key: 'comments', label: 'Comments', color: 'var(--indigo-500, #6366f1)' },
                  ]}
                />
              </div>

              <div className={styles.page__breakdowns}>
                <BreakdownPieChart
                  title="Posts by network"
                  data={data.posts_by_network}
                  colorByNetwork={networkColors}
                  totalLabel="posts"
                  emptyLabel="No posts in this period."
                />
                <BreakdownPieChart
                  title="Engagement by network"
                  data={data.engagement_by_network}
                  colorByNetwork={networkColors}
                  totalLabel="interactions"
                  emptyLabel="No likes or comments in this period."
                />
              </div>

              <div className={styles.page__topPosts}>
                <h3 className={styles.page__sectionTitle}>Top posts</h3>
                <TopPostsList posts={data.top_posts} />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

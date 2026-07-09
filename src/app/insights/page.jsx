'use client'

import useSWR from 'swr'
import { useState } from 'react'
import { useConnection } from 'wagmi'
import { ChartBarIcon, WalletIcon } from '@phosphor-icons/react'
import PageTitle from '@/components/PageTitle'
import { ContentSpinner } from '@/components/Loading'
import { useClientMounted } from '@/hooks/useClientMount'
import InsightsPeriodPicker from './_components/InsightsPeriodPicker'
import TrendChart from './_components/TrendChart'
import TopPostsList from './_components/TopPostsList'
import styles from './page.module.scss'

const numberFormatter = new Intl.NumberFormat(undefined, { notation: 'compact' })

const fetcher = async (url) => {
  const response = await fetch(url)
  const json = await response.json()
  if (!response.ok || !json.success) throw new Error(json.error || 'Insights failed to load')
  return json.data
}

function sumSeries(series, key) {
  return series?.reduce((total, point) => total + point[key], 0) || 0
}

export default function InsightsPage() {
  const mounted = useClientMounted()
  const { address, isConnected } = useConnection()
  const [period, setPeriod] = useState('30d')

  const { data, error, isLoading } = useSWR(
    isConnected && address ? `/api/v1/users/${address}/insights?period=${period}` : null,
    fetcher,
  )

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
          ) : !data.meets_threshold ? (
            <div className={styles.emptyState}>
              <ChartBarIcon size={48} />
              <h3>Insights await</h3>
              <p>Check back once you&apos;ve reached 2 followers to see your insights.</p>
            </div>
          ) : (
            <>
              <div className={styles.page__header}>
                <h2 className={styles.page__headerTitle}>Insights</h2>
                <InsightsPeriodPicker value={period} onChange={setPeriod} />
              </div>

              <div className={styles.page__stats}>
                <div className={styles.statTile}>
                  <span className={styles.statTile__label}>Followers</span>
                  <span className={styles.statTile__value}>{numberFormatter.format(data.follower_count)}</span>
                </div>
                <div className={styles.statTile}>
                  <span className={styles.statTile__label}>Profile views</span>
                  <span className={styles.statTile__value}>{numberFormatter.format(sumSeries(data.profile_views, 'count'))}</span>
                </div>
                <div className={styles.statTile}>
                  <span className={styles.statTile__label}>Post views</span>
                  <span className={styles.statTile__value}>{numberFormatter.format(sumSeries(data.reach, 'views'))}</span>
                </div>
                <div className={styles.statTile}>
                  <span className={styles.statTile__label}>Likes received</span>
                  <span className={styles.statTile__value}>{numberFormatter.format(sumSeries(data.reach, 'likes'))}</span>
                </div>
              </div>

              <div className={styles.page__charts}>
                <TrendChart
                  title="Follower growth"
                  data={data.follower_growth}
                  series={[{ key: 'count', label: 'Followers', color: 'var(--network-color-primary, #2a78d6)' }]}
                />
                <TrendChart
                  title="Profile views"
                  data={data.profile_views}
                  series={[{ key: 'count', label: 'Profile views', color: 'var(--network-color-primary, #2a78d6)' }]}
                />
                <TrendChart
                  title="Post reach"
                  data={data.reach}
                  series={[
                    { key: 'views', label: 'Views', color: '#2a78d6' },
                    { key: 'likes', label: 'Likes', color: '#1baf7a' },
                    { key: 'comments', label: 'Comments', color: '#eda100' },
                  ]}
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

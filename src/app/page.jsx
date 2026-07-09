'use client'

import { useMemo } from 'react'
import dynamic from 'next/dynamic'
import { useHomeTabsStore, resolveTabs } from '@/stores/useHomeTabsStore'
import HomeTabStrip from '@/components/HomeTabStrip'
import HomeFeedTab from '@/components/tabs/HomeFeedTab'
import styles from './page.module.scss'

// Only the default "For you" tab is bundled with the route; the other tab
// panels load on demand so they don't delay the initial navigation to "/".
const FollowingFeedTab = dynamic(() => import('@/components/tabs/FollowingFeedTab'))
const TrendingFeedTab = dynamic(() => import('@/components/tabs/TrendingFeedTab'))
const StatusFeedTab = dynamic(() => import('@/components/tabs/StatusFeedTab'))
const SearchPanel = dynamic(() => import('@/app/search/_components/SearchPanel'))
const ActivityFeed = dynamic(() => import('@/app/notifications/_components/ActivityFeed'))

export default function Page() {
  const tabs = useHomeTabsStore((state) => state.tabs)
  const resolvedTabs = useMemo(() => resolveTabs(tabs), [tabs])
  const activeTabId = useHomeTabsStore((state) => state.activeTabId)

  const activeTab = resolvedTabs.find((tab) => tab.id === activeTabId) ?? resolvedTabs[0]

  return (
    <div className={styles.page}>
      <HomeTabStrip />

      {activeTab?.type === 'foryou' && <HomeFeedTab feedMode="foryou" title="For you" />}
      {activeTab?.type === 'network' && <HomeFeedTab feedMode="network" networkId={activeTab.chainId} title={activeTab.label} />}
      {activeTab?.type === 'following' && <FollowingFeedTab />}
      {activeTab?.type === 'trending' && <TrendingFeedTab />}
      {activeTab?.type === 'status' && <StatusFeedTab />}
      {activeTab?.type === 'search' && <SearchPanel />}
      {activeTab?.type === 'notifications' && <ActivityFeed />}
    </div>
  )
}

'use client'

import { useMemo } from 'react'
import dynamic from 'next/dynamic'
import { useHomeTabsStore, resolveTabs } from '@/stores/useHomeTabsStore'
import HomeTabStrip from '@/components/HomeTabStrip'
import HomeFeedTab from '@/components/tabs/HomeFeedTab'
import HomeRail from '@/components/home/HomeRail'
import ComposePrompt from '@/components/home/ComposePrompt'
import clsx from 'clsx'
import styles from './page.module.scss'

// Only the default "For you" tab is bundled with the route; the other tab
// panels load on demand so they don't delay the initial navigation to "/".
const FollowingFeedTab = dynamic(() => import('@/components/tabs/FollowingFeedTab'))
const TrendingFeedTab = dynamic(() => import('@/components/tabs/TrendingFeedTab'))
const StatusFeedTab = dynamic(() => import('@/components/tabs/StatusFeedTab'))
const PollsTab = dynamic(() => import('@/components/tabs/PollsTab'))

export default function Page() {
  const tabs = useHomeTabsStore((state) => state.tabs)
  const resolvedTabs = useMemo(() => resolveTabs(tabs), [tabs])
  const activeTabId = useHomeTabsStore((state) => state.activeTabId)

  const activeTab = resolvedTabs.find((tab) => tab.id === activeTabId) ?? resolvedTabs[0]

  return (
    <div className={clsx(styles.page, styles.home)}>
      <div className={styles['page__tab-bar']}>
        <div className={`__container`} data-width={`small`}>
          <HomeTabStrip />
        </div>
      </div>

      {/* Keyed per tab: switching between two network tabs must remount the
          feed (not reuse the instance) so each one hydrates its own session
          cache and snapshots its own state on exit. */}
      {activeTab?.type === 'foryou' && <HomeFeedTab key={activeTab.id} feedMode="foryou" title="For you" lead={<ComposePrompt />} />}
      {activeTab?.type === 'network' && (
        <HomeFeedTab key={activeTab.id} feedMode="network" networkId={activeTab.chainId} title={activeTab.label} lead={<ComposePrompt />} />
      )}
      {activeTab?.type === 'nft' && <HomeFeedTab key={activeTab.id} feedMode="nft" title="NFTs" lead={<ComposePrompt />} />}
      {activeTab?.type === 'following' && <FollowingFeedTab />}
      {activeTab?.type === 'trending' && <TrendingFeedTab />}
      {activeTab?.type === 'status' && <StatusFeedTab />}
      {activeTab?.type === 'polls' && <PollsTab />}

      {/* Beside the feed on wide screens only; the feed column itself keeps its viewport centring.
          Last in the DOM so it stacks over the tab bar's full-width sticky background. */}
      <aside className={styles.home__rail} aria-label="Suggestions">
        <HomeRail />
      </aside>
    </div>
  )
}

'use client'

import { useMemo } from 'react'
import dynamic from 'next/dynamic'
import { useHomeTabsStore, resolveTabs } from '@/stores/useHomeTabsStore'
import { useScrollDim } from '@/hooks/useScrollDim'
import { useScrollChrome } from '@/hooks/useScrollChrome'
import HomeTabStrip from '@/components/HomeTabStrip'
import HomeFeedTab from '@/components/tabs/HomeFeedTab'
import ComposePrompt from '@/components/home/ComposePrompt'
import StatusStrip from '@/components/home/StatusStrip'
import clsx from 'clsx'
import styles from './page.module.scss'

// Only the default "For you" tab is bundled with the route; the other tab
// panels load on demand so they don't delay the initial navigation to "/".
const FollowingFeedTab = dynamic(() => import('@/components/tabs/FollowingFeedTab'))
const TrendingFeedTab = dynamic(() => import('@/components/tabs/TrendingFeedTab'))
const StatusFeedTab = dynamic(() => import('@/components/tabs/StatusFeedTab'))
const PollsTab = dynamic(() => import('@/components/tabs/PollsTab'))

// A refresh of home starts at the top: the reader asked for a fresh feed, not their old place.
// The browser's own restoration would put them back mid-feed over posts that have since changed.
// Runs once per document as this chunk loads, before the browser restores. Only the reload entry
// is affected — restoration is handed back on load, so back/forward keep their positions.
if (typeof window !== 'undefined' && performance.getEntriesByType('navigation')[0]?.type === 'reload') {
  window.history.scrollRestoration = 'manual'
  window.scrollTo({ top: 0, behavior: 'instant' })
  const restore = () => {
    window.scrollTo({ top: 0, behavior: 'instant' })
    window.history.scrollRestoration = 'auto'
  }
  if (document.readyState === 'complete') restore()
  else window.addEventListener('load', restore, { once: true })
}

// Owns the scroll-dim state on its own: held in Page, every direction change mid-scroll
// re-rendered the whole feed and stalled the scroll
function TabBar() {
  const isDimmed = useScrollDim()
  const chromeRef = useScrollChrome(isDimmed)

  return (
    <div ref={chromeRef} className={styles['page__tab-bar']}>
      <div className={`__container`} data-width={`small`}>
        <HomeTabStrip />
      </div>
    </div>
  )
}

export default function Page() {
  const tabs = useHomeTabsStore((state) => state.tabs)
  const resolvedTabs = useMemo(() => resolveTabs(tabs), [tabs])
  const activeTabId = useHomeTabsStore((state) => state.activeTabId)

  const activeTab = resolvedTabs.find((tab) => tab.id === activeTabId) ?? resolvedTabs[0]

  return (
    <div className={clsx(styles.page, styles.home)}>
      <TabBar />

      {/* Keyed per tab: switching between two network tabs must remount the
          feed (not reuse the instance) so each one hydrates its own session
          cache and snapshots its own state on exit. */}
      {activeTab?.type === 'foryou' && (
        <HomeFeedTab
          key={activeTab.id}
          feedMode="foryou"
          title="For you"
          lead={
            <>
              <StatusStrip />
              <ComposePrompt />
            </>
          }
        />
      )}
      {activeTab?.type === 'network' && (
        <HomeFeedTab key={activeTab.id} feedMode="network" networkId={activeTab.chainId} title={activeTab.label} lead={<ComposePrompt />} />
      )}
      {activeTab?.type === 'nft' && <HomeFeedTab key={activeTab.id} feedMode="nft" title="NFTs" lead={<ComposePrompt />} />}
      {activeTab?.type === 'following' && <FollowingFeedTab />}
      {activeTab?.type === 'trending' && <TrendingFeedTab />}
      {activeTab?.type === 'status' && <StatusFeedTab />}
      {activeTab?.type === 'polls' && <PollsTab />}

    </div>
  )
}

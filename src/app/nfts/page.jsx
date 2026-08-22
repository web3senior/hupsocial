'use client'

import { Suspense } from 'react'
import PageTitle from '@/components/PageTitle'
import SectionTabs from '@/components/ui/SectionTabs'
import MarketViews from './_components/MarketViews'
import styles from './page.module.scss'

// NFT market: two readings of the same HupTrade data, read straight from the indexed
// nft_listings/nft_trades tables (see GET /api/v1/nfts) — not the post feed. Items is a
// search/filter grid of individual listings; Collections ranks the collections behind them.
// Both read their state from the query string (useSearchParams), which requires a Suspense
// boundary for the prerendered route.
export default function Page() {
  return (
    <>
      <PageTitle name="NFT Market" />
      <SectionTabs section="bazaar" />
      <div className={`${styles.page} animate fade`}>
        {/* The card shell is the sibling section pages' (drops, swap, launches), but its width
            belongs to whichever view is up — a league table needs room a feed-width column
            can't give it — so MarketViews carries it and picks the data-width */}
        <Suspense>
          <MarketViews shellClassName={styles.page__container} />
        </Suspense>
      </div>
    </>
  )
}

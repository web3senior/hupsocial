'use client'

import { Suspense } from 'react'
import PageTitle from '@/components/PageTitle'
import SectionTabs from '@/components/ui/SectionTabs'
import NftMarketGrid from './_components/NftMarketGrid'
import styles from './page.module.scss'

// NFT market: a search/filter grid of HupTrade listings read straight from the
// indexed nft_listings table (see GET /api/v1/nfts) — not the post feed.
// The grid reads its filters from the query string (useSearchParams), which
// requires a Suspense boundary for the prerendered route.
export default function Page() {
  return (
    <>
      <PageTitle name="NFT Market" />
      <SectionTabs section="bazaar" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          <Suspense>
            <NftMarketGrid />
          </Suspense>
        </div>
      </div>
    </>
  )
}

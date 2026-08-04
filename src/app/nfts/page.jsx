'use client'

import { Suspense } from 'react'
import PageTitle from '@/components/PageTitle'
import NftMarketGrid from './_components/NftMarketGrid'

// NFT market: a search/filter grid of HupTrade listings read straight from the
// indexed nft_listings table (see GET /api/v1/nfts) — not the post feed.
// The grid reads its filters from the query string (useSearchParams), which
// requires a Suspense boundary for the prerendered route.
export default function Page() {
  return (
    <>
      <PageTitle name="NFT Market" />
      <Suspense>
        <NftMarketGrid />
      </Suspense>
    </>
  )
}

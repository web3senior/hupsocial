'use client'

import PageTitle from '@/components/PageTitle'
import NftMarketGrid from './_components/NftMarketGrid'

// NFT market: a search/filter grid of HupTrade listings read straight from the
// indexed nft_listings table (see GET /api/v1/nfts) — not the post feed.
export default function Page() {
  return (
    <>
      <PageTitle name="NFT Market" />
      <NftMarketGrid />
    </>
  )
}

'use client'

import PageTitle from '@/components/PageTitle'
import HomeFeedTab from '@/components/tabs/HomeFeedTab'

// NFT market: the home feed filtered to posts with an active HupTrade NFT listing
// (feed_type=nft on the posts API), across all networks. PageTitle renders here (not
// via HomeFeedTab) so the page gets the fixed header title + spacer like every other
// standalone page.
export default function Page() {
  return (
    <>
      <PageTitle name="NFT Market" />
      <HomeFeedTab feedMode="nft" title="NFT Market" />
    </>
  )
}

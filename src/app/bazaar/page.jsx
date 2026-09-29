'use client'

import PageTitle from '@/components/PageTitle'
import HomeFeedTab from '@/components/tabs/HomeFeedTab'

// Marketplace posts: the home feed filtered to premium posts — posts with an active
// HupBazaar listing (feed_type=premium on the posts API), across all networks.
// PageTitle renders here (not via HomeFeedTab) so the page gets the fixed
// header title + spacer like every other standalone page.
export default function Page() {
  return (
    <>
      <PageTitle name="Marketplace" />
      <HomeFeedTab feedMode="premium" title="Marketplace" containerWidth="medium" />
    </>
  )
}

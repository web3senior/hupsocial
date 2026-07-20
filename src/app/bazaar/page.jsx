'use client'

import PageTitle from '@/components/PageTitle'
import HomeFeedTab from '@/components/tabs/HomeFeedTab'

// Bazaar: the home feed filtered to premium posts — posts with an active
// HupBazaar listing (feed_type=premium on the posts API), across all networks.
// PageTitle renders here (not via HomeFeedTab) so the page gets the fixed
// header title + spacer like every other standalone page.
export default function Page() {
  return (
    <>
      <PageTitle name="Bazaar" />
      <HomeFeedTab feedMode="premium" title="Bazaar" />
    </>
  )
}

'use client'

import HomeFeedTab from '@/components/tabs/HomeFeedTab'

// Bazaar: the home feed filtered to premium posts — posts with an active
// HupBazaar listing (feed_type=premium on the posts API), across all networks.
export default function Page() {
  return <HomeFeedTab feedMode="premium" title="Bazaar" changeDocumentTitle />
}

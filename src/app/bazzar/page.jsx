'use client'

import HomeFeedTab from '@/components/tabs/HomeFeedTab'

// Bazzar: the home feed filtered to premium posts — posts with an active
// HupStore listing (feed_type=premium on the posts API), across all networks.
export default function Page() {
  return <HomeFeedTab feedMode="premium" title="Bazzar" changeDocumentTitle />
}

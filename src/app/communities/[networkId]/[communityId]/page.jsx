import { cache } from 'react'
import { fetchCommunityRow } from '@/lib/communityRows'
import CommunityDetails from './_components/CommunityDetails'
import styles from './page.module.scss'

// Straight to the indexed row, not out through this app's own /api/v1 route. A server component
// self-fetching its own API is a full request/response back through the server for a query it can
// run itself — and NEXT_PUBLIC_BASE_URL carries a trailing slash, so the URL it built ended up as
// `//api/v1/...`, which Next answers with a 308 and turns one hop into two.
//
// Deduplicated so generateMetadata and Page share one query per render. No viewer address: this
// render is shared by everyone who opens the community, so membership standing is the client's
// to ask for.
const fetchCommunity = cache((networkId, communityId) => fetchCommunityRow({ networkId, communityId }))

export async function generateMetadata({ params }, parent) {
  const parentMetadata = await parent
  const { networkId, communityId } = await params

  try {
    const community = await fetchCommunity(networkId, communityId)

    const description = community?.summary || community?.description || parentMetadata.description || 'View this community on Hup.'

    const ogImages = community?.logo_url
      ? [{ url: community.logo_url, width: 1200, height: 630, alt: community.name || 'Community' }]
      : [{ url: '/open-graph.png', width: 1200, height: 630, alt: 'Open Graph Image' }]

    return {
      title: community?.name || 'Community',
      description,
      openGraph: { images: ogImages },
      twitter: { card: 'summary_large_image', images: ogImages },
    }
  } catch (error) {
    return {
      title: 'Community Not Found',
      description: parentMetadata.description || 'The requested community was not found.',
    }
  }
}

export default async function Page({ params }) {
  const { networkId, communityId } = await params
  const community = await fetchCommunity(networkId, communityId).catch(() => null)

  // The whole indexed row travels down with the RSC payload, not just its name. It is the exact
  // row the client used to re-request for itself after hydration — one round trip behind a
  // shimmer, for data the server already had in hand.
  return (
    <div className={styles.page}>
      <CommunityDetails networkId={networkId} communityId={communityId} initialCommunity={community} />
    </div>
  )
}

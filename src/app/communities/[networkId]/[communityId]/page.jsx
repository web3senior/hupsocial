import { cache } from 'react'
import { getCommunityById } from '@/lib/api'
import CommunityDetails from './_components/CommunityDetails'
import styles from './page.module.scss'

// Deduplicate the fetch so generateMetadata and Page share one request per render
const fetchCommunity = cache((networkId, communityId) => getCommunityById(networkId, communityId))

export async function generateMetadata({ params }, parent) {
  const parentMetadata = await parent
  const { networkId, communityId } = await params

  try {
    const res = await fetchCommunity(networkId, communityId)
    const community = res?.data

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
  const res = await fetchCommunity(networkId, communityId).catch(() => null)

  return (
    <div className={styles.page}>
      <CommunityDetails networkId={networkId} communityId={communityId} initialName={res?.data?.name} />
    </div>
  )
}

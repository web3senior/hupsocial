import { cache } from 'react'
import PageTitle from '@/components/PageTitle'
import FundDetail from './_components/FundDetail'
import styles from './page.module.scss'

// Server-side campaign fetch for generateMetadata, mirroring the poll page's pattern; cache()
// deduplicates if a future server read joins the render
const fetchCampaign = cache(async (networkId, campaignId) => {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://localhost:3000'
  const response = await fetch(`${baseUrl}/api/v1/fund/${campaignId}?networkId=${networkId}`, { next: { revalidate: 30 } })
  if (!response.ok) throw new Error('Campaign fetch failed')
  return response.json()
})

export async function generateMetadata({ params }, parent) {
  const parentMetadata = await parent
  const { networkId, campaignId } = await params

  try {
    const res = await fetchCampaign(networkId, campaignId)
    const campaign = res?.data?.campaign

    return {
      title: campaign?.title || 'Fundraise',
      description: campaign?.description?.slice(0, 200) || parentMetadata.description || 'Raise onchain, in the open.',
    }
  } catch (error) {
    return {
      title: 'Fundraise',
      description: parentMetadata.description || 'Raise onchain, in the open.',
    }
  }
}

export default async function Page({ params }) {
  const { networkId, campaignId } = await params
  // cache() shares this fetch with generateMetadata — one request per render
  const res = await fetchCampaign(networkId, campaignId).catch(() => null)

  return (
    <>
      <PageTitle name={res?.data?.campaign?.title || 'Fundraise'} />
      <div className={styles.page}>
        <div className={`__container ${styles.page__container}`} data-width="small">
          <FundDetail networkId={networkId} campaignId={campaignId} />
        </div>
      </div>
    </>
  )
}

import { cache } from 'react'
import PageTitle from '@/components/PageTitle'
import MarketDetail from './_components/MarketDetail'
import styles from './page.module.scss'

// Server-side market fetch for generateMetadata, mirroring lib/api's pattern; cache()
// deduplicates if a future server read joins the render
const fetchMarket = cache(async (networkId, marketId) => {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://localhost:3000'
  const response = await fetch(`${baseUrl}/api/v1/predict/${marketId}?networkId=${networkId}`, { next: { revalidate: 30 } })
  if (!response.ok) throw new Error('Market fetch failed')
  return response.json()
})

export async function generateMetadata({ params }, parent) {
  const parentMetadata = await parent
  const { networkId, marketId } = await params

  try {
    const res = await fetchMarket(networkId, marketId)
    const market = res?.data?.market

    return {
      title: market?.title || 'Prediction market',
      description: market?.description || parentMetadata.description || 'Bet on outcomes with friends on Hup.',
    }
  } catch (error) {
    return {
      title: 'Prediction market',
      description: parentMetadata.description || 'Bet on outcomes with friends on Hup.',
    }
  }
}

export default async function Page({ params }) {
  const { networkId, marketId } = await params
  // cache() shares this fetch with generateMetadata — one request per render
  const res = await fetchMarket(networkId, marketId).catch(() => null)

  return (
    <>
      <PageTitle name={res?.data?.market?.title || 'Prediction market'} />
      <div className={styles.page}>
        <div className={`__container ${styles.page__container}`} data-width="small">
          <MarketDetail networkId={networkId} marketId={marketId} />
        </div>
      </div>
    </>
  )
}

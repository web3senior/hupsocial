import { cache } from 'react'
import PageTitle from '@/components/PageTitle'
import LaunchDetail from './_components/LaunchDetail'
import styles from './page.module.scss'

// Server-side launch fetch for generateMetadata, mirroring the predict detail page; cache()
// deduplicates if a future server read joins the render
const fetchLaunch = cache(async (networkId, launchId) => {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://localhost:3000'
  const response = await fetch(`${baseUrl}/api/v1/launches/${networkId}/${launchId}`, { next: { revalidate: 30 } })
  if (!response.ok) throw new Error('Launch fetch failed')
  return response.json()
})

export async function generateMetadata({ params }, parent) {
  const parentMetadata = await parent
  const { networkId, id } = await params

  try {
    const res = await fetchLaunch(networkId, id)
    const launch = res?.data

    return {
      title: launch ? `${launch.name} ($${launch.symbol})` : 'Token launch',
      description: launch?.description || parentMetadata.description || 'Launch and trade memecoins on Hup.',
    }
  } catch {
    return {
      title: 'Token launch',
      description: parentMetadata.description || 'Launch and trade memecoins on Hup.',
    }
  }
}

export default async function Page({ params }) {
  const { networkId, id } = await params
  // cache() shares this fetch with generateMetadata — one request per render
  const res = await fetchLaunch(networkId, id).catch(() => null)

  return (
    <>
      <PageTitle name={res?.data ? `${res.data.name} ($${res.data.symbol})` : 'Token launch'} />
      <div className={styles.page}>
        <div className={`__container ${styles.page__container}`} data-width="small">
          <LaunchDetail networkId={Number(networkId)} launchId={String(id)} initialLaunch={res?.data ?? null} />
        </div>
      </div>
    </>
  )
}

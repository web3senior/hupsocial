import { cache } from 'react'
import PageTitle from '@/components/PageTitle'
import CollectionView from './_components/CollectionView'
import styles from './page.module.scss'

// Server-side collection fetch for generateMetadata, mirroring the listing detail page;
// cache() deduplicates if a future server read joins the render
const fetchCollection = cache(async (networkId, address) => {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://localhost:3000'
  const response = await fetch(`${baseUrl}/api/v1/nfts/collections/${networkId}/${address.toLowerCase()}`, { next: { revalidate: 300 } })
  if (!response.ok) throw new Error('Collection fetch failed')
  return response.json()
})

export async function generateMetadata({ params }, parent) {
  const parentMetadata = await parent
  const { networkId, address } = await params

  try {
    const res = await fetchCollection(networkId, address)
    const name = res?.data?.name

    return {
      title: name ? `${name} — NFT collection` : 'NFT collection',
      description: res?.data?.description?.slice(0, 200) || parentMetadata.description || 'Browse this collection on the Hup NFT Market.',
    }
  } catch (error) {
    return {
      title: 'NFT collection',
      description: parentMetadata.description || 'Browse this collection on the Hup NFT Market.',
    }
  }
}

export default async function Page({ params }) {
  const { networkId, address } = await params

  return (
    <>
      {/* Header clearance + initial title, like the listing detail page — the spacer must
          sit outside the rounded container. CollectionView re-titles with the collection's
          name once metadata loads, spacerless so the gap never doubles. */}
      <PageTitle name="NFT collection" />
      <div className={styles.page}>
        <div className={`__container ${styles.page__container}`} data-width="large">
          <CollectionView networkId={networkId} address={address} />
        </div>
      </div>
    </>
  )
}

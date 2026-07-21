import { cache } from 'react'
import PageTitle from '@/components/PageTitle'
import ListingDetail from './_components/ListingDetail'
import styles from './page.module.scss'

// Server-side listing fetch for generateMetadata, mirroring the predict detail page; cache()
// deduplicates if a future server read joins the render
const fetchListing = cache(async (networkId, listingId) => {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://localhost:3000'
  const response = await fetch(`${baseUrl}/api/v1/nfts/${listingId}?networkId=${networkId}`, { next: { revalidate: 30 } })
  if (!response.ok) throw new Error('Listing fetch failed')
  return response.json()
})

export async function generateMetadata({ params }, parent) {
  const parentMetadata = await parent
  const { networkId, listingId } = await params

  try {
    const res = await fetchListing(networkId, listingId)
    const status = Number(res?.data?.listing?.status)

    return {
      title: status === 2 ? `NFT listing #${listingId} — Sold` : `NFT listing #${listingId}`,
      description: parentMetadata.description || 'Buy and sell NFTs inside posts on Hup.',
    }
  } catch (error) {
    return {
      title: 'NFT listing',
      description: parentMetadata.description || 'Buy and sell NFTs inside posts on Hup.',
    }
  }
}

export default async function Page({ params }) {
  const { networkId, listingId } = await params

  return (
    <>
      {/* Header clearance + initial title, like the predict page — the spacer must sit
          outside the rounded container. ListingDetail re-titles with the NFT's name once
          metadata loads (its later effect wins), spacerless so the gap never doubles. */}
      <PageTitle name={`NFT listing #${listingId}`} />
      <div className={styles.page}>
        <div className={`__container ${styles.page__container}`} data-width="small">
          <ListingDetail networkId={networkId} listingId={listingId} />
        </div>
      </div>
    </>
  )
}

import PageTitle from '@/components/PageTitle'
import MyOffers from './_components/MyOffers'

// My offers: every NFT offer the connected wallet has made, across all chains where
// HupOffers is deployed — cancel live ones, reclaim escrow from expired ones. Reads the
// same cidex-indexed nft_offers table as the listing page's offer book.
export default function Page() {
  return (
    <>
      <PageTitle name="My offers" />
      <MyOffers />
    </>
  )
}

import PageTitle from '@/components/PageTitle'
import MyOffers from './_components/MyOffers'
import styles from './page.module.scss'

// My offers: every NFT offer the connected wallet has made, across all chains where
// HupOffers is deployed — cancel live ones, reclaim escrow from expired ones. Reads the
// same cidex-indexed nft_offers table as the listing page's offer book.
export default function Page() {
  return (
    <>
      <PageTitle name="My offers" />
      {/* Same container every directory page uses — main is full-bleed and the sidebar is
          fixed over it, so content without this sits underneath the nav */}
      <div className={styles.page}>
        <div className={`__container ${styles.page__container}`} data-width={`xlarge`}>
          <MyOffers />
        </div>
      </div>
    </>
  )
}

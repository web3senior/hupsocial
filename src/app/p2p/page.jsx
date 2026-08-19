'use client'

import { Suspense } from 'react'
import PageTitle from '@/components/PageTitle'
import SectionTabs from '@/components/ui/SectionTabs'
import P2pDirectory from './_components/P2pDirectory'
import styles from './page.module.scss'

// P2P trading — OTC to anyone who already knows the term, which is why the page says both.
// Escrow-backed deals for fungible assets (native coins and ERC20/LSP7 tokens) through the
// same HupOffers contract the NFT market's offers use: a deal is an offer whose asset happens
// to be fungible, the buyer escrows the payment up front, and whoever holds the asset delivers
// it to settle. Deals can be locked to one counterparty, which is what makes a price agreed in
// chat settle at that price and nowhere else.
export default function Page() {
  return (
    <>
      <PageTitle name="P2P Trading" />
      <SectionTabs section="trade" />
      {/* Same container every directory page uses — main is full-bleed and the sidebar is
          fixed over it, so content without this sits underneath the nav */}
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          <Suspense>
            <P2pDirectory />
          </Suspense>
        </div>
      </div>
    </>
  )
}

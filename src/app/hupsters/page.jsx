'use client'

import PageTitle from '@/components/PageTitle'
import HomeFeedTab from '@/components/tabs/HomeFeedTab'
import { HUPSTER_TAG } from '@/lib/roles'
import HupstersIntro from './_components/HupstersIntro'
import styles from './_components/HupstersIntro.module.scss'

// The program page: what Hupsters are, how to join and get tipped, the ranking, and — as the feed
// itself — every proof post Hupsters have tagged, each with the tip button the team pays from.
export default function HupstersPage() {
  return (
    <>
      <PageTitle name="Hupsters" />
      <HomeFeedTab
        feedMode="hupsters"
        title="Hupsters"
        lead={<HupstersIntro />}
        emptyState={
          <p className={styles.hupsters__empty}>
            No proof posts yet. Hupsters: post on Hup with your link and #{HUPSTER_TAG} and it shows up here.
          </p>
        }
      />
    </>
  )
}

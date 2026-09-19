'use client'

import PageTitle from '@/components/PageTitle'
import PremiumPlans from './_components/PremiumPlans'
import styles from './page.module.scss'

export default function PremiumPage() {
  return (
    <>
      <PageTitle name="Premium" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="small">
          <PremiumPlans />
        </div>
      </div>
    </>
  )
}

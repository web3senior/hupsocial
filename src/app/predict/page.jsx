'use client'

import PageTitle from '@/components/PageTitle'
import SectionTabs from '@/components/ui/SectionTabs'
import PredictDirectory from './_components/PredictDirectory'
import styles from './page.module.scss'

export default function PredictPage() {
  return (
    <>
      <PageTitle name="Predict" />
      <SectionTabs section="trade" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          <PredictDirectory />
        </div>
      </div>
    </>
  )
}

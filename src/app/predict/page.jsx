'use client'

import PageTitle from '@/components/PageTitle'
import PredictDirectory from './_components/PredictDirectory'
import styles from './page.module.scss'

export default function PredictPage() {
  return (
    <>
      <PageTitle name="Predict" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="small">
          <PredictDirectory />
        </div>
      </div>
    </>
  )
}

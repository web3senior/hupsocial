'use client'

import PageTitle from '@/components/PageTitle'
import FundDirectory from './_components/FundDirectory'
import styles from './page.module.scss'

export default function FundPage() {
  return (
    <>
      <PageTitle name="Fundraise" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="small">
          <FundDirectory />
        </div>
      </div>
    </>
  )
}

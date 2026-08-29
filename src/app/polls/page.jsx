'use client'

import PageTitle from '@/components/PageTitle'
import PollsDirectory from './_components/PollsDirectory'
import styles from './page.module.scss'

export default function PollsPage() {
  return (
    <>
      <PageTitle name="Polls" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="small">
          <PollsDirectory />
        </div>
      </div>
    </>
  )
}

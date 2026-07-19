'use client'

import PageTitle from '@/components/PageTitle'
import EventsDirectory from './_components/EventsDirectory'
import styles from './page.module.scss'

export default function EventsPage() {
  return (
    <>
      <PageTitle name="Events" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="small">
          <EventsDirectory />
        </div>
      </div>
    </>
  )
}

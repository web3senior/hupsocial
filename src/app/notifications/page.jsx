import { Suspense } from 'react'
import PageTitle from '@/components/PageTitle'
import ActivityFeed from './_components/ActivityFeed'
import styles from './page.module.scss'

export default function Page() {
  return (
    <>
      <PageTitle name={`Activity`} />
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          <Suspense fallback={<div>Loading activity system...</div>}>
            <ActivityFeed />
          </Suspense>
        </div>
      </div>
    </>
  )
}

import PageTitle from '@/components/PageTitle'
import ActivityFeed from './_components/ActivityFeed'
import styles from './page.module.scss'

export default function Page() {
  return (
    <>
      <PageTitle name={`Notifications`} />
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          <ActivityFeed />
        </div>
      </div>
    </>
  )
}

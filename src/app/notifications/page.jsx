import clsx from 'clsx'
import PageTitle from '@/components/PageTitle'
import ActivityFeed from './_components/ActivityFeed'
import styles from './page.module.scss'

export default function Page() {
  return (
    <>
      <PageTitle name={`Notifications`} />
      <div className={styles.page}>
        <div className={clsx('__container', styles.page__container)} data-width="small">
          <ActivityFeed />
        </div>
      </div>
    </>
  )
}

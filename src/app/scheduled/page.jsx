import PageTitle from '@/components/PageTitle'
import ScheduledPosts from './_components/ScheduledPosts'
import styles from './page.module.scss'

export const metadata = {
  title: 'Scheduled posts',
}

export default function Page() {
  return (
    <>
      <PageTitle name="Scheduled posts" />
      <div className={styles.page}>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          <ScheduledPosts />
        </div>
      </div>
    </>
  )
}

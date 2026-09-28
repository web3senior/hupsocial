import PageTitle from '@/components/PageTitle'
import LiveDirectory from './_components/LiveDirectory'
import styles from './page.module.scss'

export const metadata = {
  title: 'Live',
  description: 'Watch live streams on Hup and tip the streamer onchain.',
  alternates: { canonical: '/live' },
}

export default function Page() {
  return (
    <>
      <PageTitle name="Live" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          <LiveDirectory />
        </div>
      </div>
    </>
  )
}

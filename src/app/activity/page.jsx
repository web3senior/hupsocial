import PageTitle from '@/components/PageTitle'
import ActivityStream from './_components/ActivityStream'
import styles from './page.module.scss'

export const metadata = {
  title: 'Activity',
  description: 'Everything happening on Hup right now — posts, likes, follows, NFT sales, offers, tips, bets and swaps.',
}

export default function Page() {
  return (
    <>
      <PageTitle name={`Activity`} />
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          <p className={styles.page__lede}>Every onchain action on Hup, newest first, across all networks.</p>
          <ActivityStream />
        </div>
      </div>
    </>
  )
}

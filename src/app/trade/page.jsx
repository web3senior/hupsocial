import PageTitle from '@/components/PageTitle'
import LaunchDirectory from './_components/LaunchDirectory'
import styles from './page.module.scss'

export const metadata = {
  title: 'Trade',
  description: 'Launch and trade memecoins on Hup.',
}

export default function LaunchesPage() {
  return (
    <>
      <PageTitle name="Trade" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="xxlarge">
          <LaunchDirectory />
        </div>
      </div>
    </>
  )
}

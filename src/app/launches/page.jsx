import PageTitle from '@/components/PageTitle'
import LaunchDirectory from './_components/LaunchDirectory'
import styles from './page.module.scss'

export const metadata = {
  title: 'Tokens',
  description: 'Launch and trade memecoins on Hup.',
}

export default function LaunchesPage() {
  return (
    <>
      <PageTitle name="Tokens" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="small">
          <LaunchDirectory />
        </div>
      </div>
    </>
  )
}

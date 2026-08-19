import PageTitle from '@/components/PageTitle'
import SectionTabs from '@/components/ui/SectionTabs'
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
      <SectionTabs section="trade" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          <LaunchDirectory />
        </div>
      </div>
    </>
  )
}

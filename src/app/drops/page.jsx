import PageTitle from '@/components/PageTitle'
import DropsDirectory from './_components/DropsDirectory'
import styles from './page.module.scss'

export const metadata = {
  title: 'Drops',
  description: 'Launch and mint NFT drops on Hup.',
}

export default function DropsPage() {
  return (
    <>
      <PageTitle name="Drops" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="small">
          <DropsDirectory />
        </div>
      </div>
    </>
  )
}

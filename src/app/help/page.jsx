import PageTitle from '@/components/PageTitle'
import HelpCenter from './_components/HelpCenter'
import styles from './page.module.scss'

export default function Page() {
  return (
    <>
      <PageTitle name={`Help Center`} />
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          <HelpCenter />
        </div>
      </div>
    </>
  )
}

import PageTitle from '@/components/PageTitle'
import Settings from './_components/Settings'
import styles from './page.module.scss'

export default function Page() {
  return (
    <>
      <PageTitle name={`Settings`} />
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <div className={`__container ${styles.page__container}`} data-width="large">
          <Settings />
        </div>
      </div>
    </>
  )
}

import { Suspense } from 'react'
import PageTitle from '@/components/PageTitle'
import SettingsNav from './_components/SettingsNav'
import styles from './page.module.scss'

export default function Page() {
  return (
    <>
      <PageTitle name={`Settings`} />

      <div className={`${styles.page}`}>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          {/* Suspense: SettingsNav reads ?tab= via useSearchParams, which requires a boundary */}
          <Suspense fallback={null}>
            <SettingsNav />
          </Suspense>
        </div>
      </div>
    </>
  )
}

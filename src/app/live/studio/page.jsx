import PageTitle from '@/components/PageTitle'
import LiveStudio from './_components/LiveStudio'
import styles from '../page.module.scss'

export const metadata = {
  title: 'Go live',
  robots: { index: false },
}

export default function Page() {
  return (
    <>
      <PageTitle name="Go live" backHref="/live" backLabel="Live" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          <LiveStudio />
        </div>
      </div>
    </>
  )
}

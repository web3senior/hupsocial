import clsx from 'clsx'
import PageTitle from '@/components/PageTitle'
import { ContentSpinner } from '@/components/Loading'
import styles from './page.module.scss'

/**
 * The page's own shell, so the first navigation here lands on the card the tool renders into
 * rather than the root list skeleton. It stays invisible for a beat, so a quick fetch never
 * flashes it at all.
 */
export default function Loading() {
  return (
    <>
      <PageTitle name="Collection audit" />
      <div className={styles.page}>
        <div className={clsx('__container', styles.page__container, styles['page__container--loading'])} data-width="large">
          <ContentSpinner />
        </div>
      </div>
    </>
  )
}

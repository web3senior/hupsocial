import PageTitle from '@/components/PageTitle'
import DaoDirectory from './_components/DaoDirectory'
import styles from './page.module.scss'

export const metadata = {
  title: 'Proposals',
  description: 'Start a group, put ideas to a vote, and let someone you trust vote for you.',
}

export default function ProposalsPage() {
  return (
    <>
      <PageTitle name="Proposals" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="small">
          <DaoDirectory />
        </div>
      </div>
    </>
  )
}

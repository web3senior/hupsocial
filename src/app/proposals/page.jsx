import PageTitle from '@/components/PageTitle'
import CommunityProposalDirectory from './_components/CommunityProposalDirectory'
import styles from './page.module.scss'

export const metadata = {
  title: 'Proposals',
  description: 'Create community proposals, vote as a member, and approve treasury payments.',
}

export default function ProposalsPage() {
  return (
    <>
      <PageTitle name="Proposals" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="small">
          <CommunityProposalDirectory />
        </div>
      </div>
    </>
  )
}

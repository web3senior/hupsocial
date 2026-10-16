import PageTitle from '@/components/PageTitle'
import ProposalDetail from '../../../_components/ProposalDetail'
import styles from '../../../page.module.scss'

export const metadata = {
  title: 'Proposal',
  description: 'A proposal, its votes and its result, counted onchain.',
}

export default async function Page({ params }) {
  const { networkId, groupId, proposalId } = await params

  return (
    <>
      <PageTitle name="Proposal" />
      <div className={styles.page}>
        <div className={`__container ${styles.page__container}`} data-width="small">
          <ProposalDetail networkId={networkId} daoId={groupId} proposalId={proposalId} />
        </div>
      </div>
    </>
  )
}

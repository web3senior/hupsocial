import { notFound } from 'next/navigation'
import clsx from 'clsx'
import PageTitle from '@/components/PageTitle'
import CommunityProposalDetail from '@/app/proposals/_components/CommunityProposalDetail'
import styles from '@/app/proposals/page.module.scss'

export const metadata = { title: 'Community proposal' }

export default async function Page({ params }) {
  const { networkId, communityId, proposalId } = await params
  if (!/^\d+$/.test(networkId) || !/^[1-9]\d*$/.test(communityId) || !/^[1-9]\d*$/.test(proposalId)) notFound()
  return (
    <>
      <PageTitle name="Community proposal" />
      <div className={styles.page}>
        <div className={clsx('__container', styles.page__container)} data-width="small">
          <CommunityProposalDetail key={`${networkId}:${communityId}:${proposalId}`} networkId={networkId} communityId={communityId} proposalId={proposalId} />
        </div>
      </div>
    </>
  )
}

import { notFound } from 'next/navigation'
import CommunityProposalDetail from '@/app/proposals/_components/CommunityProposalDetail'
import styles from '../../page.module.scss'

export const metadata = { title: 'Community proposal' }

export default async function Page({ params }) {
  const { networkId, communityId, proposalId } = await params
  if (!/^\d+$/.test(networkId) || !/^[1-9]\d*$/.test(communityId) || !/^[1-9]\d*$/.test(proposalId)) notFound()
  return <div className={styles.page}><div className="__container" data-width="medium"><CommunityProposalDetail key={`${networkId}:${communityId}:${proposalId}`} networkId={networkId} communityId={communityId} proposalId={proposalId} /></div></div>
}

import { notFound } from 'next/navigation'
import { fetchCommunityRow } from '@/lib/communityRows'
import CommunityGovernance from '@/app/proposals/_components/CommunityGovernance'
import styles from '../page.module.scss'

export const metadata = { title: 'Community proposals & treasury' }

export default async function Page({ params }) {
  const { networkId, communityId } = await params
  if (!/^\d+$/.test(networkId) || !/^[1-9]\d*$/.test(communityId)) notFound()
  const community = await fetchCommunityRow({ networkId, communityId }).catch(() => null)
  return <div className={styles.page}><div className="__container" data-width="medium"><CommunityGovernance key={`${networkId}:${communityId}`} networkId={networkId} communityId={communityId} communityName={community?.name} /></div></div>
}

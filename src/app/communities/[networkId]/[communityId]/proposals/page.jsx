import { notFound } from 'next/navigation'
import clsx from 'clsx'
import PageTitle from '@/components/PageTitle'
import { fetchCommunityRow } from '@/lib/communityRows'
import CommunityGovernance from '@/app/proposals/_components/CommunityGovernance'
import styles from '@/app/proposals/page.module.scss'

export const metadata = { title: 'Community proposals & treasury' }

export default async function Page({ params }) {
  const { networkId, communityId } = await params
  if (!/^\d+$/.test(networkId) || !/^[1-9]\d*$/.test(communityId)) notFound()
  const community = await fetchCommunityRow({ networkId, communityId }).catch(() => null)
  return (
    <>
      <PageTitle name="Community proposals & treasury" />
      <div className={styles.page}>
        <div className={clsx('__container', styles.page__container)} data-width="small">
          <CommunityGovernance key={`${networkId}:${communityId}`} networkId={networkId} communityId={communityId} communityName={community?.name} />
        </div>
      </div>
    </>
  )
}

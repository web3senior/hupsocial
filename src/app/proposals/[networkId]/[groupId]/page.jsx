import PageTitle from '@/components/PageTitle'
import DaoDetail from '../../_components/DaoDetail'
import styles from '../../page.module.scss'

export const metadata = {
  title: 'Group',
  description: 'A group’s proposals, votes and members, counted onchain.',
}

export default async function Page({ params }) {
  const { networkId, groupId } = await params

  return (
    <>
      <PageTitle name="Group" />
      <div className={styles.page}>
        <div className={`__container ${styles.page__container}`} data-width="small">
          <DaoDetail networkId={networkId} daoId={groupId} />
        </div>
      </div>
    </>
  )
}

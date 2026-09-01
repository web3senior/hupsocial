import { Suspense } from 'react'
import PageTitle from '@/components/PageTitle'
import CollectionAuditTool from './_components/CollectionAuditTool'
import styles from './page.module.scss'

export const metadata = {
  title: 'Collection audit',
  description: 'Score any NFT collection on where its bytes live, whether they can still be fetched and what the contract can change.',
}

export default function CollectionAuditPage() {
  return (
    <>
      <PageTitle name="Collection audit" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="large">
          {/* The tool reads its target from the query string, which is a client-side concern */}
          <Suspense fallback={null}>
            <CollectionAuditTool />
          </Suspense>
        </div>
      </div>
    </>
  )
}

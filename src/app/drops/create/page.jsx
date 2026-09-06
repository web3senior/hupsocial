import { Suspense } from 'react'
import PageTitle from '@/components/PageTitle'
import CreateDropView from './_components/CreateDropView'
import styles from './page.module.scss'

export const metadata = {
  title: 'Create a drop',
  description: 'Deploy an NFT collection you own and open minting on your own terms.',
}

export default function CreateDropPage() {
  return (
    <>
      <PageTitle name="Create a drop" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="large">
          {/* useSearchParams reads the ?chain= link, so the view needs a boundary to render into */}
          <Suspense fallback={null}>
            <CreateDropView />
          </Suspense>
        </div>
      </div>
    </>
  )
}

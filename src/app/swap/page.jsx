import { Suspense } from 'react'
import PageTitle from '@/components/PageTitle'
import SectionTabs from '@/components/ui/SectionTabs'
import SwapForm from './_components/SwapForm'
import styles from './page.module.scss'

export const metadata = {
  title: 'Swap',
  description: 'Swap tokens onchain, straight against Uniswap pools.',
}

export default function SwapPage() {
  return (
    <>
      <PageTitle name="Swap" />
      <SectionTabs section="trade" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          {/* The form seeds its pair from ?chain=&token= (useSearchParams), which needs a
              boundary or the whole route opts out of prerendering */}
          <Suspense>
            <SwapForm />
          </Suspense>
        </div>
      </div>
    </>
  )
}

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
          <SwapForm />
        </div>
      </div>
    </>
  )
}

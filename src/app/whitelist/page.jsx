import PageTitle from '@/components/PageTitle'
import WhitelistJoin from './_components/WhitelistJoin'
import styles from './page.module.scss'

export const metadata = {
  title: '$HUP whitelist',
  description: 'Get your wallet on the $HUP whitelist before launch. One free signature, no transaction.',
}

export default function WhitelistPage() {
  return (
    <>
      <PageTitle name="Whitelist" containerWidth="small" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="small">
          <WhitelistJoin />
        </div>
      </div>
    </>
  )
}

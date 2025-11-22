import { WalletOptions } from '@/components/ConnectWallet'
import styles from './page.module.scss'

export default function Page() {
  return (
    <>
      <PageTitle name={`connect`} />
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <div className={`__container ${styles.page__container} flex flex-column align-items-center justify-content-center`} data-width={`medium`}>
          <WalletOptions />
        </div>
      </div>
    </>
  )
}

import { WalletOptions } from '@/components/ConnectWallet'
import styles from './page.module.scss'

export default function Page() {
  return (
    <div className={`${styles.page} ms-motion-slideDownIn`}>
      <h3 className={`page-title`}>connect</h3>

      <div className={`__container ${styles.page__container} flex flex-column align-items-center justify-content-center`} data-width={`medium`}>
        <WalletOptions />
      </div>
    </div>
  )
}

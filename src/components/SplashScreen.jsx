import Image from 'next/image'
import logo from '@/../public/hup.svg'
import arattalabs from '@/../public/arattalabs.svg'
import styles from './SplashScreen.module.scss'

export default function SplashScreen() {
  return (
    <div className={styles.wrapper} role="status" aria-label="Loading application">
      <div className={styles.mainContent}>
        <div className={styles.logoWrapper}>
          <Image src={logo} alt="Hup Logo" priority className={styles.mainLogo} />
        </div>
      </div>

      <div className={styles.attribution}>
        <div className={styles.brand}>
          <Image src={arattalabs} alt="ArattaLabs" width={28} height={28} />
          <div className={styles.brand__name}>
            <small>Powered by</small>
            <span>ArattaLabs</span>
          </div>
        </div>
      </div>
    </div>
  )
}

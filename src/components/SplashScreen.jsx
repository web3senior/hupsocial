import Image from 'next/image'
import logo from '@/../public/logo.svg'
import arattalabs from '@/../public/arattalabs.svg'
import styles from './SplashScreen.module.scss'

export default function SplashScreen() {
  const appName = process.env.NEXT_PUBLIC_NAME || 'Hup'

  return (
    <div className={styles.wrapper} role="status" aria-live="polite" aria-label="Loading application">
      <main className={styles.mainContent}>
        <div className={styles.logoWrapper}>
          <Image
            src={logo}
            alt={`${appName} Logo`}
            priority
            className={styles.mainLogo}
          />
        </div>
      </main>

      <footer className={styles.attribution}>
        <div className={styles.brand}>
          <Image
            src={arattalabs}
            alt="ArattaLabs"
            width={28}
            height={28}
            className={styles.brandLogo}
          />

          <div className={styles.brandName}>
            <small>Powered by</small>
            <span>ArattaLabs</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
import Image from 'next/image'
import logo from '@/../public/logo.svg'
import styles from './SplashScreen.module.scss'

export default function SplashScreen() {
  return (
    <div
      className={styles.wrapper}
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      <Image
        src={logo}
        alt="Logo"
        priority
        className={styles.logo}
        width={72}
        height={72}
      />

      <footer className={styles.footer}>
        <span className={styles.label}>fully onchain</span>
      </footer>
    </div>
  )
}

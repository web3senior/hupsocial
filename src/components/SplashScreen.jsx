import Image from 'next/image'
import logo from '@/../public/logo.svg'
import styles from './SplashScreen.module.scss'

// Purely a boot curtain: it fades itself out in CSS and never intercepts input, so the shell
// behind it is reachable on schedule whether or not hydration has landed.
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
        <span className={styles.label}>decentralized</span>
      </footer>
    </div>
  )
}

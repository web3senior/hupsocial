import Image from 'next/image'
import logo from '@/../public/logo.svg'
import styles from './SplashScreen.module.scss'

const FALLBACK_APP_NAME = 'Hup'
const TAGLINE = 'onchain • social 3.0 • open source'

export default function SplashScreen() {
  const appName = process.env.NEXT_PUBLIC_NAME?.trim() || FALLBACK_APP_NAME

  return (
    <div
      className={styles.wrapper}
      role="status"
      aria-live="polite"
      aria-label={`Loading ${appName}`}
    >
      <Image
        src={logo}
        alt={`${appName} logo`}
        priority
        className={styles.logo}
      />

      <footer className={styles.footer}>{TAGLINE}</footer>
    </div>
  )
}
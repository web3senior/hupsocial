import Image from 'next/image'
import logo from '@/../public/logo.svg'
import styles from './SplashScreen.module.scss'

const FALLBACK_APP_NAME = 'Hup'
const FALLBACK_AUTHOR = 'Hup Labs'

export default function SplashScreen() {
  // Extract environment variables with safe fallbacks
  const appName = process.env.NEXT_PUBLIC_NAME?.trim() || FALLBACK_APP_NAME
  const authorName = process.env.NEXT_PUBLIC_AUTHOR?.trim() || FALLBACK_AUTHOR

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
        width={128} 
        height={128} 
      />

      <footer className={styles.footer}>
        <p className={styles.attribution}>
          <span className={styles.label}>by</span>
          <span className={styles.author}>{authorName}</span>
        </p>
      </footer>
    </div>
  )
}
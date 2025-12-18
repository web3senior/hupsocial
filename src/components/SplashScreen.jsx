// components/SplashScreen.tsx
import styles from './SplashScreen.module.scss'

export default function SplashScreen() {
  return (
    <div className={styles.wrapper}>
      <div className={styles.logoContainer}>
        <div className={styles.loader}></div>
        <h1>Hup</h1>
      </div>
    </div>
  )
}
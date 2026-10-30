import styles from './VaultAttribution.module.scss'

export default function VaultAttribution() {
  return (
    <p className={styles.attribution}>
      <a href="https://safe.global" target="_blank" rel="noreferrer"><span className={styles.attribution__logo} aria-hidden="true" />Built on Safe</a>
    </p>
  )
}

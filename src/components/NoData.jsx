import styles from './NoData.module.scss'

export default function NoData({ name }) {
  return (
    <div className={`${styles.tabContentEmpty} d-f-c`}>
      <p style={{ color: `var(--gray-400)` }}>No {name} yet.</p>
    </div>
  )
}

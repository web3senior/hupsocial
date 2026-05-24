import NoData from '../NoData'
import styles from './SettingsTab.module.scss'

export default function SettingsTab() {
  return (
    <div className={`${styles.tabContent} ${styles.communitiesTab} relative`}>
      <div className={`__container`} data-width={`medium`}>
        <NoData name={`events`} />
      </div>
    </div>
  )
}

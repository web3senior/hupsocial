import NoData from '../NoData'
import styles from './EventsTab.module.scss'

export default function EventsTab() {
  return (
    <div className={`${styles.tabContent} ${styles.communitiesTab} relative`}>
      <div className={`__container`} data-width={`medium`}>
        <NoData name={`communities`} />
      </div>
    </div>
  )
}

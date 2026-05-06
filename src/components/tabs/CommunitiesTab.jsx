import NoData from '../NoData'
import styles from './CommunitiesTab.module.scss'

export default function CommunitiesTab() {
  return (
    <div className={`${styles.tabContent} ${styles.communitiesTab} relative`}>
      <div className={`__container`} data-width={`medium`}>
        <NoData name={`communities`} />
      </div>
    </div>
  )
}

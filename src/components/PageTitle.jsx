import Link from 'next/link'
import styles from './PageTitle.module.scss'

const PageTitle = ({name}) => (
  <div className={`text-center ${styles.pageTitle}`}>
    <span>{name}</span>
  </div>
)

export default PageTitle

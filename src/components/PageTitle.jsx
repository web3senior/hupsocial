import Link from 'next/link'
import styles from './PageTitle.module.scss'

const PageTitle = (props) => (
  <div className={`mb-10 ${styles.pageTitle}`}>
    <h1>{props.title}</h1>
  </div>
)

export default PageTitle

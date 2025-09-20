import Link from 'next/link'
import styles from './Heading.module.scss'

const Heading = (props) => (
  <div className={`d-f-c flex-column w-100 mb-30 ${styles.heading}`}>
    <h1 className={`ss02`}>{props.title}</h1>
    <small className={`ff-vazir`}>{props.subTitle}</small>
    <Link href={props.link}>مشاهده همه</Link>
  </div>
)

export default Heading

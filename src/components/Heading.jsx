import Link from 'next/link'
import styles from './Heading.module.scss'

const Heading = (props) => (
  <div className={`d-f-c flex-column w-10 mb-10 ${styles.heading}`}>
    <h1>{props.title}</h1>
    <small>{props.subTitle}</small>
  </div>
)

export default Heading

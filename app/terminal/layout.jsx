import Head from 'next/head'
import Nav from './nav'
import styles from './Layout.module.scss'

export default function UserLayout({ children }) {
  return (
    <div className={`${styles.page} ms-motion-slideDownIn h-100`}>
      {/* <div className={`__container ${styles.page__container} d-flex grid--gap-1`} data-width={`medium`}> */}
      {/* <div className={`h-100`}>
          <Nav />
        </div> */}
      {children}
      {/* </div> */}
    </div>
  )
}

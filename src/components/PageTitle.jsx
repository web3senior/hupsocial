'use client'

import { useEffect, memo } from 'react'
import styles from './PageTitle.module.scss'

const PageTitle = ({ name }) => {
  useEffect(() => {
    if (name) {
      document.title = `${name} | ${process.env.NEXT_PUBLIC_NAME}`
    }
  }, [name])

  if (!name) return null

  return (
    <header className={styles.stickyHeader}>
        <div className={`__container`} data-width={`small`}>
            <h1 className={`${styles.pageTitle} d-f-c`}>
        <span>{name}</span>
      </h1> 
        </div>
   
    </header>
  )
}

export default memo(PageTitle)

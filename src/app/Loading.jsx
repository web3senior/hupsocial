import Link from 'next/link'
import Image from 'next/image'
import React from 'react'
import styles from './Loading.module.scss'

export const FullPageLoading = () => (
  <div className={styles['loading']}>
    <div className={`${styles['loading__container']} d-f-c flex-column`}>
      <div />
    </div>
  </div>
)

export const MiniLoading = () => (
  <div className={styles['loading']}>
    <div className={`${styles['loading__container']} d-f-c flex-column`}>
      <div />
    </div>
  </div>
)

export default FullPageLoading
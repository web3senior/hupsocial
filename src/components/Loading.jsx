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

export const InlineLoading = () => (
  <div className={styles['inline-loading']}>
    <svg height="100%" viewBox="0 0 32 32" width="100%">
      <circle cx="16" cy="16" fill="none" r="14" stroke-width="4" style={{ stroke: `#424242`, opacity: `.2` }}></circle>
      <circle cx="16" cy="16" fill="none" r="14" stroke-width="4" style={{ stroke: `#424242`, strokeDasharray: `80`, strokeDashoffset: `60` }}>
        <animateTransform attributeName="transform" attributeType="XML" type="rotate" dur="1s" from="0 16 16" to="360 16 16" repeatCount="indefinite" />
      </circle>
    </svg>
  </div>
)

export default FullPageLoading

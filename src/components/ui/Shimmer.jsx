// Shimmer.jsx
import React from 'react'
import styles from './Shimmer.module.scss'

export default function Shimmer({ children, style, className }) {
  return (
    <div className={`${styles.shimmer} ${className || ''}`} style={style} aria-live="polite" aria-busy="true">
      {children}
    </div>
  )
}

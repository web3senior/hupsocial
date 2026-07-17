'use client'

import { useState } from 'react'
import clsx from 'clsx'
import styles from './Counter.module.scss'

/**
 * Animated counter value for footer action buttons.
 * Renders statically on mount and plays the slide-up animation only when the
 * value changes afterwards — a remount (e.g. the detail page's Suspense swap)
 * must not replay every counter's entry animation.
 * @param {Object} props
 * @param {number} props.value Raw count driving change detection and the span key.
 * @param {React.ReactNode} [props.children] Formatted display; defaults to the raw value.
 */
export const Counter = ({ value, children }) => {
  // Never updated — pins the value this instance mounted with
  const [initialValue] = useState(value)

  return (
    <div className={styles.counterWrapper}>
      <span key={value} className={clsx(styles.counterNumber, value !== initialValue && styles.counterNumberEnter)}>
        {children ?? value}
      </span>
    </div>
  )
}

export default Counter

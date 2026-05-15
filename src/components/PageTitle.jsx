'use client'

import { useEffect, memo } from 'react'
import styles from './PageTitle.module.scss'

/**
 * PageTitle Component
 * Sets the document title and renders a sticky header.
 */
const PageTitle = ({ name = '' }) => {
  useEffect(() => {
    // Avoid running logic if name is empty
    if (!name) return

    const siteName = process.env.NEXT_PUBLIC_NAME || 'Default Site'
    document.title = `${name} | ${siteName}`
    
    // Optional: Cleanup function to reset title when component unmounts
    return () => {
      document.title = siteName
    }
  }, [name])

  // Early return pattern: keeps the main return block clean
  if (!name) return null

  return (
    <header className={styles.stickyHeader}>
      <h1 className={styles.pageTitle}>
        <span>{name}</span>
      </h1>
    </header>
  )
}

// Exporting with memo to prevent re-renders unless 'name' changes
export default memo(PageTitle)
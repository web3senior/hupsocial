'use client'

import { useEffect, memo } from 'react'
import { usePageTitleStore } from '@/stores/usePageTitleStore'
import styles from './PageTitle.module.scss'

/**
 * PageTitle Component
 * Pushes the page name into usePageTitleStore so the fixed Header can render
 * it centered, and optionally syncs document.title. Kept as a component (not
 * a hook) so server-component pages can still declare their title. Renders a
 * spacer so page content clears the fixed header.
 */
const PageTitle = ({ name = '', changeDocumentTitle = true }) => {
  const setTitle = usePageTitleStore((state) => state.setTitle)
  const clearTitle = usePageTitleStore((state) => state.clearTitle)

  useEffect(() => {
    if (!name) return

    setTitle(name)

    // Clear on unmount so a route without a PageTitle shows an empty center
    return () => clearTitle()
  }, [name, setTitle, clearTitle])

  useEffect(() => {
    if (!name || !changeDocumentTitle) return

    const siteName = process.env.NEXT_PUBLIC_NAME
    document.title = `${siteName} | ${name}`

    return () => {
      document.title = siteName
    }
  }, [name, changeDocumentTitle])

  if (!name) return null

  return <div aria-hidden="true" className={styles['pageTitle__spacer']} />
}

export default memo(PageTitle)

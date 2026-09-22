'use client'

import { useEffect, memo } from 'react'
import clsx from 'clsx'
import { usePageTitleStore } from '@/stores/usePageTitleStore'
import styles from './PageTitle.module.scss'

/**
 * PageTitle Component
 * Pushes the page name into usePageTitleStore so the fixed Header can render
 * it centered, and optionally syncs document.title. Kept as a component (not
 * a hook) so server-component pages can still declare their title. Renders a
 * spacer so page content clears the fixed header; pass spacer={false} to
 * render nothing, or paddingTop={false} for the shorter spacer. backHref puts
 * a back arrow before a left-aligned title, so it paints with the header instead
 * of arriving with the page body and shifting it; subtitle adds a muted second
 * line. containerWidth takes the page's data-width step so the header lines up
 * with its content.
 */
const PageTitle = ({
  name = '',
  changeDocumentTitle = true,
  paddingTop = true,
  spacer = true,
  showInHeader = true,
  backHref = '',
  backLabel = 'Back',
  subtitle = '',
  containerWidth = '',
}) => {
  const setTitle = usePageTitleStore((state) => state.setTitle)
  const clearTitle = usePageTitleStore((state) => state.clearTitle)

  useEffect(() => {
    // showInHeader={false} keeps document.title in sync but leaves the fixed
    // header's center empty - for views that already label themselves (home tabs)
    if (!name || !showInHeader) return

    setTitle(name, {
      subtitle,
      back: backHref ? { href: backHref, label: backLabel } : null,
      width: containerWidth,
    })

    // Clear on unmount so a route without a PageTitle shows an empty center
    return () => clearTitle()
  }, [name, showInHeader, subtitle, backHref, backLabel, containerWidth, setTitle, clearTitle])

  useEffect(() => {
    if (!name || !changeDocumentTitle) return

    const siteName = process.env.NEXT_PUBLIC_NAME
    document.title = `${siteName} | ${name}`

    return () => {
      document.title = siteName
    }
  }, [name, changeDocumentTitle])

  if (!name || !spacer) return null

  return <div aria-hidden="true" className={clsx(styles['pageTitle__spacer'], paddingTop && styles['pageTitle__spacer--padded'])} />
}

export default memo(PageTitle)

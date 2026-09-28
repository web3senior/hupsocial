'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeftIcon } from '@phosphor-icons/react'
import { ConnectWallet } from '@/components/ConnectWallet'
import { useCanGoBack } from '@/hooks/useCanGoBack'
import { usePageTitleStore } from '@/stores/usePageTitleStore'
import { useSidebarStore } from '@/stores/useSidebarStore'
import { Menu } from './Icons'
import clsx from 'clsx'
import styles from './Header.module.scss'

const DESKTOP_QUERY = '(min-width: 768px)'

// The page's bordered shell: the first wide container in <main> that draws a side border
const findPageShell = (main) =>
  [...main.querySelectorAll('div[class*="__container"]')].find((element) => {
    if (getComputedStyle(element).borderLeftWidth === '0px') return false
    return element.getBoundingClientRect().width > 300
  })

/**
 * Where the title bar sits: over the page's own shell, so the title centres on the card and the
 * back arrow starts at its edge. Pages never say how wide they are (PageTitle's containerWidth
 * goes unused), so the shell is measured.
 * Null on phones, where shells go borderless, and while no shell is on the page.
 */
const useTitleCell = (isActive, pathname) => {
  const [cell, setCell] = useState(null)

  useEffect(() => {
    const main = document.querySelector('main')
    if (!isActive || !main) {
      setCell(null)
      return undefined
    }

    const measure = () => {
      const shell = window.matchMedia(DESKTOP_QUERY).matches ? findPageShell(main) : null
      if (!shell) {
        setCell(null)
        return
      }

      const rect = shell.getBoundingClientRect()
      const next = { left: Math.round(rect.left), width: Math.round(rect.width) }
      setCell((prev) => (prev && prev.left === next.left && prev.width === next.width ? prev : next))
    }

    measure()
    // <main> resizes as the page's content arrives, which is also when a late shell mounts
    const observer = new ResizeObserver(measure)
    observer.observe(main)
    window.addEventListener('resize', measure)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [isActive, pathname])

  return cell
}

export default function Header() {
  const pathname = usePathname()
  const router = useRouter()
  const canGoBack = useCanGoBack(pathname)
  const title = usePageTitleStore((state) => state.title)
  const subtitle = usePageTitleStore((state) => state.subtitle)
  const back = usePageTitleStore((state) => state.back)
  const width = usePageTitleStore((state) => state.width)
  const isMobileMenuOpen = useSidebarStore((state) => state.isMobileMenuOpen)
  const openMobileMenu = useSidebarStore((state) => state.openMobileMenu)

  // The feed's own heading row is home's top bar, so there the header is just Connect floating over it
  const isBare = pathname === '/'
  const hasTitle = Boolean(title || back)
  const cell = useTitleCell(hasTitle, pathname)

  const cellStyle = cell && {
    '--title-cell-left': `${cell.left}px`,
    '--title-cell-width': `${cell.width}px`,
  }

  // Back returns to the page the reader came from; the href is only for a first page of the
  // visit, and for a new-tab click.
  const backLabel = canGoBack ? 'Back' : back?.label
  const handleBack = (event) => {
    if (!canGoBack || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    router.back()
  }

  return (
    <header className={clsx(styles.header, isBare && styles['header--bare'])}>
      <button
        type="button"
        className={styles.menuButton}
        onClick={openMobileMenu}
        aria-label="Open menu"
        aria-expanded={isMobileMenuOpen}
        data-mobile-menu-trigger
      >
        <Menu />
      </button>

      {hasTitle && (
        // Full-width layer so the container inside centres against the same box as the page's
        // own containers, clearing the aside the same way. With a measured shell it sits over
        // that shell instead.
        <div className={clsx(styles.header__bar, cell && styles['header__bar--cell'])} style={cellStyle || undefined}>
          <div className={clsx('__container', styles.header__inner)} data-width={cell ? undefined : width || undefined}>
            {back && (
              <Link href={back.href} className={styles.back} aria-label={backLabel} title={backLabel} onClick={handleBack}>
                <ArrowLeftIcon size={20} aria-hidden="true" />
              </Link>
            )}
            {title && (
              <div className={clsx(styles.header__heading, back && styles['header__heading--start'])}>
                <h1 className={styles.header__title}>
                  <span>{title}</span>
                </h1>
                {subtitle && <p className={styles.header__subtitle}>{subtitle}</p>}
              </div>
            )}
          </div>
        </div>
      )}

      <div className={clsx(styles.connectWallet, 'flex justify-content-end align-items-center gap-050')}>
        <ConnectWallet />
      </div>
    </header>
  )
}

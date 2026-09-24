'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeftIcon } from '@phosphor-icons/react'
import { ConnectWallet } from '@/components/ConnectWallet'
import { usePageTitleStore } from '@/stores/usePageTitleStore'
import { useSidebarStore } from '@/stores/useSidebarStore'
import { Menu } from './Icons'
import clsx from 'clsx'
import styles from './Header.module.scss'

const DESKTOP_QUERY = '(min-width: 768px)'
// A container starting further below the header than this has something above it (tabs, a
// banner), so the title cell closes itself off instead of stretching down to meet it
const CELL_JOIN_SLACK = 8

// The page's bordered shell: the first wide container in <main> that draws a side border
const findPageShell = (main) =>
  [...main.querySelectorAll('div[class*="__container"]')].find((element) => {
    if (getComputedStyle(element).borderLeftWidth === '0px') return false
    return element.getBoundingClientRect().width > 300
  })

/**
 * Where the title's bordered cell sits: over the page's own shell, so its side borders carry the
 * column's up to the top of the viewport and its bottom border meets the shell's top edge. Pages
 * never say how wide they are (PageTitle's containerWidth goes unused), so the shell is measured.
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
      const top = Math.round(rect.top + window.scrollY)
      const headerHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || 0
      const next = { left: Math.round(rect.left), width: Math.round(rect.width), top, joined: top > 0 && top <= headerHeight + CELL_JOIN_SLACK }
      setCell((prev) =>
        prev && prev.left === next.left && prev.width === next.width && prev.top === next.top && prev.joined === next.joined ? prev : next
      )
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

  // Reaching down to the shell's top edge (plus the 1px that lays this bottom border over the
  // shell's top one), unless something sits between them
  const cellStyle = cell && {
    '--title-cell-left': `${cell.left}px`,
    '--title-cell-width': `${cell.width}px`,
    '--title-cell-height': `${cell.top + 1}px`,
  }
  const isJoined = Boolean(cell?.joined)

  return (
    <header className={clsx(styles.header, isBare && styles['header--bare'])}>
      {pathname !== '/chat' && (
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
      )}

      {hasTitle && (
        // Full-width layer so the container inside centres against the same box as the page's
        // own containers, clearing the aside the same way. With a measured shell it becomes the
        // column's bordered top cell instead.
        <div
          className={clsx(styles.header__bar, cell && styles['header__bar--cell'], cell && !isJoined && styles['header__bar--closed'])}
          style={cellStyle || undefined}
        >
          <div className={clsx('__container', styles.header__inner)} data-width={cell ? undefined : width || undefined}>
            {back && (
              <Link href={back.href} className={styles.back} aria-label={back.label} title={back.label}>
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

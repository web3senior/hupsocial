'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ConnectWallet } from '@/components/ConnectWallet'
import BackLink from '@/components/ui/BackLink'
import { useScrollDim } from '@/hooks/useScrollDim'
import logo from '@/../public/logo.svg'
import { usePageTitleStore } from '@/stores/usePageTitleStore'
import { useSidebarStore } from '@/stores/useSidebarStore'
import { Menu } from './Icons'
import clsx from 'clsx'
import styles from './Header.module.scss'

const DESKTOP_QUERY = '(min-width: 768px)'
// /networks/{networkId}/{postId}, the post page — not the network list or a network's own page
const POST_ROUTE = /^\/networks\/[^/]+\/[^/]+\/?$/

// The page's bordered shell: the first wide container in <main> that draws a side border
const findPageShell = (main) =>
  [...main.querySelectorAll('div[class*="__container"]')].find((element) => {
    if (getComputedStyle(element).borderLeftWidth === '0px') return false
    return element.getBoundingClientRect().width > 300
  }) || [...main.querySelectorAll('div[class*="__container"][data-width]')].find((element) => element.getBoundingClientRect().width > 300)

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

    let markedShell = null

    const measure = () => {
      const shell = window.matchMedia(DESKTOP_QUERY).matches ? findPageShell(main) : null
      if (shell !== markedShell) {
        markedShell?.removeAttribute('data-page-shell')
        shell?.setAttribute('data-page-shell', '')
        markedShell = shell
      }
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
      markedShell?.removeAttribute('data-page-shell')
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

  // The feed's own heading row is home's top bar, so there the header is just Connect floating over
  // it. A post page is the same: its title row (PostTitleRow) sits in the header's strip on a
  // desktop and needs the clicks. Matched by path so a post opened in place gets it too.
  const isBare = pathname === '/' || POST_ROUTE.test(pathname ?? '')
  const hasTitle = Boolean(title || back)
  const cell = useTitleCell(hasTitle, pathname)
  // Fades with the footer nav while browsing down (phones only, see Header.module.scss)
  const isDimmed = useScrollDim()

  const cellStyle = cell && {
    '--title-cell-left': `${cell.left}px`,
    '--title-cell-width': `${cell.width}px`,
  }

  return (
    <header className={clsx(styles.header, isBare && styles['header--bare'], isDimmed && styles['header--dimmed'])}>
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

      {/* Phones without a page title get the brand mark in the middle; the sidebar has it on desktops */}
      {!hasTitle && (
        <Link href="/" className={styles.header__logo} aria-label="Home">
          <Image src={logo} alt={`${process.env.NEXT_PUBLIC_NAME || 'Hup'} logo`} width={28} height={28} priority />
        </Link>
      )}

      {hasTitle && (
        // Full-width layer so the container inside centres against the same box as the page's
        // own containers, clearing the aside the same way. With a measured shell it sits over
        // that shell instead.
        <div className={clsx(styles.header__bar, cell && styles['header__bar--cell'])} style={cellStyle || undefined}>
          <div className={clsx('__container', styles.header__inner)} data-width={cell ? undefined : width || undefined}>
            {back && <BackLink href={back.href} label={back.label} className={styles.back} />}
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

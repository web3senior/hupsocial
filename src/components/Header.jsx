'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeftIcon } from '@phosphor-icons/react'
import { ConnectWallet } from '@/components/ConnectWallet'
import { useSidebarStore } from '@/stores/useSidebarStore'
import { usePageTitleStore } from '@/stores/usePageTitleStore'
import HeaderSearch from './HeaderSearch'
import clsx from 'clsx'
import styles from './Header.module.scss'
import { Menu } from './Icons'

export default function Header() {
  const pathname = usePathname()
  const { isMenuOpen, openMobileMenu } = useSidebarStore()
  const title = usePageTitleStore((state) => state.title)
  const subtitle = usePageTitleStore((state) => state.subtitle)
  const back = usePageTitleStore((state) => state.back)
  const width = usePageTitleStore((state) => state.width)

  // The feed labels itself with its tab strip, so home is the one route that leaves the
  // centre slot empty - search takes it there, the page title everywhere else.
  const isHome = pathname === '/'

  return (
    <header className={styles.header}>
      {pathname !== '/chat' && (
        <button
          type="button"
          className={styles.menuButton}
          onClick={openMobileMenu}
          aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={isMenuOpen}
        >
          <Menu />
        </button>
      )}

      {isHome ? (
        <HeaderSearch />
      ) : (
        (title || back) && (
          // Full-width layer so the container inside centres against the same box as the page's
          // own containers, clearing the aside the same way
          <div className={styles.header__bar}>
            <div className={clsx('__container', styles.header__inner)} data-width={width || undefined}>
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
        )
      )}

      <div className={clsx(styles.connectWallet, 'flex justify-content-end align-items-center gap-050')}>
        <ConnectWallet />
      </div>
    </header>
  )
}

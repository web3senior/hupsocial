'use client'

import { usePathname } from 'next/navigation'
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
        title && (
          <h1 className={styles['header__title']}>
            <span>{title}</span>
          </h1>
        )
      )}

      <div className={clsx(styles.connectWallet, 'flex justify-content-end align-items-center gap-050')}>
        <ConnectWallet />
      </div>
    </header>
  )
}

'use client'

import clsx from 'clsx'
import Link from 'next/link'
import { ConnectWallet } from '@/components/ConnectWallet'
import { Equal, X } from 'lucide-react'
import { useSidebarStore } from '@/stores/useSidebarStore'
import styles from './Header.module.scss'

export default function Header() {
  const { navItems, isMenuOpen, isMobileMenuOpen, openMobileMenu, closeMobileMenu } = useSidebarStore()

  return (
    <header className={styles.header}>
      <button
        type="button"
        className={styles.menuButton}
        onClick={openMobileMenu}
        aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={isMenuOpen}
      >
        <Equal size={24} />
      </button>

      <div className={clsx(styles.connectWallet, 'flex justify-content-end align-items-center gap-050')}>
        <ConnectWallet />
      </div>
    </header>
  )
}

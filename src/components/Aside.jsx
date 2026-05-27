'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useConnection } from 'wagmi'
import clsx from 'clsx'
import {
  Book,
  Bug,
  Circle,
  Code,
  Equal,
  Heart,
  HelpCircle,
  LayoutGridIcon,
  MessageSquareWarning,
  Monitor,
  Moon,
  Palette,
  PanelRightClose,
  PanelRightOpen,
  Settings,
  SquareTerminal,
  Sun,
  UserRound,
} from 'lucide-react'

import logo from '@/../public/logo.svg'
import NewPost from '@/components/NewPost'
import { useClientMounted } from '@/hooks/useClientMount'
import { useSidebarStore } from '@/stores/useSidebarStore'
import NativePopover from './ui/NativePopover'
import styles from './Aside.module.scss'

const NAV_COMPONENTS = {
  'new-post': NewPost,
}

const isActivePath = (pathname, path) => {
  if (!pathname || !path) return false
  if (path === '/') return pathname === '/'
  return pathname === path || pathname.startsWith(`${path}/`)
}

const normalizeNavItem = (item) => {
  if (item.name === 'br' || item.type === 'divider') {
    return {
      id: item.id,
      type: 'divider',
    }
  }

  return {
    id: item.id ?? item.path ?? item.href ?? item.component ?? item.name ?? item.label,
    name: item.name ?? item.label,
    path: item.path ?? item.href,
    icon: item.icon,
    component: item.component,
  }
}

const NavLink = ({ item, isActive, isCompact, onNavigate }) => {
  const [isComponentOpen, setIsComponentOpen] = useState(false)

  if (item.type === 'divider') {
    return <hr className={styles.divider} aria-hidden="true" />
  }

  const Icon = item.icon ?? Circle
  const Component = typeof item.component === 'string' ? NAV_COMPONENTS[item.component] : item.component

  const content = (
    <>
      <div className={styles.iconWrapper}>
        <Icon
          size={20}
          fill={isActive ? 'currentColor' : 'none'}
          strokeWidth={isActive ? 2 : 1.5}
        />
      </div>
      {!isCompact && <span className={styles.linkText}>{item.name}</span>}
    </>
  )

  if (Component) {
    return (
      <>
        <button
          type="button"
          className={clsx(styles.link, styles.moreButton)}
          title={isCompact ? item.name : undefined}
          aria-label={item.name}
          onClick={() => {
            setIsComponentOpen(true)
            onNavigate?.()
          }}
        >
          {content}
        </button>

        {isComponentOpen && (
          <Component
            item={item}
            onClose={() => setIsComponentOpen(false)}
          />
        )}
      </>
    )
  }

  return (
    <Link
      href={item.path}
      className={clsx(styles.link, isActive && styles.linkActive)}
      title={isCompact ? item.name : undefined}
      aria-current={isActive ? 'page' : undefined}
      onClick={onNavigate}
    >
      {content}
    </Link>
  )
}
export default function Aside() {
  const pathname = usePathname()
  const { address, isConnected } = useConnection()
  const mounted = useClientMounted()
  const { theme, setTheme } = useTheme()

  const navItems = useSidebarStore((state) => state.navItems)
  const isMenuOpen = useSidebarStore((state) => state.isMenuOpen)
  const toggleMenu = useSidebarStore((state) => state.toggleMenu)
  const toggleMobileMenu = useSidebarStore((state) => state.toggleMobileMenu)
  const closeMenu = useSidebarStore((state) => state.closeMenu)
  const isMobileMenuOpen = useSidebarStore((state) => state.isMobileMenuOpen)
  const closeMobileMenu = useSidebarStore((state) => state.closeMobileMenu)

  const [isWideScreen, setIsWideScreen] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia('(min-width: 768px)')

    setIsWideScreen(mql.matches)

    const handleChange = (event) => setIsWideScreen(event.matches)
    mql.addEventListener('change', handleChange)

    return () => mql.removeEventListener('change', handleChange)
  }, [])

  const navLinks = useMemo(() => {
    const profilePath = isConnected && address ? `/${address}` : '/connect'

    return [
      ...navItems.map(normalizeNavItem).filter((item) => item.type === 'divider' || item.path || item.component),
      {
        id: 'profile',
        name: 'Profile',
        path: profilePath,
        icon: UserRound,
      },
    ]
  }, [address, isConnected, navItems])

  const isMobileLayout = !isWideScreen
  const isExpanded = isMobileLayout ? isMobileMenuOpen : isMenuOpen
  const isCompact = !isExpanded
  const shouldShowMobileMenu = isMobileLayout && isMobileMenuOpen
  const closeSidebar = isMobileLayout ? closeMobileMenu : closeMenu

  const handleToggleMenu = () => {
    if (isMobileLayout) {
      toggleMobileMenu()
    } else {
      toggleMenu()
    }
  }

  if (!mounted) {
    return <aside className={styles.aside} style={{ width: '68px' }} />
  }

  return (
    <aside
      className={clsx(
        styles.aside,
        !isMobileLayout && (isExpanded ? styles.expanded : styles.compact),
        shouldShowMobileMenu && styles.show,
        shouldShowMobileMenu && styles.expanded,
      )}
    >
      <div className={styles.navContainer}>
        <header className={styles.header}>
          <div className={styles.logoWrapper}>
            <Link href="/" className="flex align-items-center gap-025" aria-label="Home">
              <Image src={logo} alt={`${process.env.NEXT_PUBLIC_NAME || 'Hup'} logo`} width={28} height={28} priority />
              {isExpanded && <span className={styles.logoCap}>{process.env.NEXT_PUBLIC_NAME || 'Hup'}</span>}
            </Link>
          </div>

          {isExpanded && (
            <button
              type="button"
              className={styles.menuButton}
              onClick={handleToggleMenu}
              aria-label="Collapse sidebar"
              aria-expanded={isExpanded}
            >
              <PanelRightOpen size={18} strokeWidth={1.5} />
            </button>
          )}

          <button
            type="button"
            className={clsx(styles.menuButton, styles.menuButtonFloat)}
            onClick={handleToggleMenu}
            aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-expanded={isExpanded}
          >
            {isExpanded ? <PanelRightOpen size={18} strokeWidth={1.5} /> : <PanelRightClose size={18} strokeWidth={1.5} />}
          </button>
        </header>

        <ul className={styles.navList}>
          {navLinks.map((item, index) => (
            <li key={item.id ?? `${item.type}-${index}`}>
              <NavLink item={item} isActive={isActivePath(pathname, item.path)} isCompact={isCompact} onNavigate={closeSidebar} />
            </li>
          ))}
        </ul>

        <div className={styles.footerNav}>
          <NativePopover
            trigger={
              <button
                type="button"
                className={clsx(styles.link, styles.moreButton)}
                title={isCompact ? 'More' : undefined}
                aria-label="More"
              >
                <div className={styles.iconWrapper}>
                  <Equal size={24} />
                </div>
                {!isCompact && <span className={styles.linkText}>More</span>}
              </button>
            }
            placement="top-end"//top-end
            type="auto"
          >
            {({ close }) => (
              <div className={styles.popoverContent}>
                <ul className="flex flex-column gap-050">
                  <li>
                    <Link href="/settings" onClick={close} className="flex align-items-center gap-050">
                      <Settings size={16} />
                      <span>Settings</span>
                    </Link>
                  </li>
                  <li>
                    <Link href="/liked" onClick={close} className="flex align-items-center gap-050">
                      <Heart size={16} />
                      <span>Liked</span>
                    </Link>
                  </li>
                  <li>
                    <div className="flex align-items-center gap-050">
                      <Palette size={16} />
                      <span>Theme</span>
                    </div>
                    <div className={clsx(styles.themeWrapper, 'grid grid--fit grid--gap-025')} style={{ '--data-width': '60px' }}>
                      <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>
                        <Sun size={16} />
                        <span>Light</span>
                      </button>
                      <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>
                        <Moon size={16} />
                        <span>Dark</span>
                      </button>
                      <button type="button" aria-pressed={theme === 'terminal'} onClick={() => setTheme('terminal')}>
                        <SquareTerminal size={16} />
                        <span>Terminal</span>
                      </button>
                      <button type="button" aria-pressed={theme === 'system'} onClick={() => setTheme('system')}>
                        <Monitor size={16} />
                        <span>System</span>
                      </button>
                    </div>
                  </li>
                  <li>
                    <a
                      href="https://docs.hup.social"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={close}
                      className="flex align-items-center gap-050"
                    >
                      <Book size={16} />
                      <span>Documentation</span>
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://y7imctkw83d.typeform.com/to/kRWVNq6u"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={close}
                      className="flex align-items-center gap-050"
                    >
                      <MessageSquareWarning size={16} />
                      <span>Send feedback</span>
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://docs.google.com/forms/d/e/1FAIpQLSc-o--ue7vCnL54kg5H_M_-PbtFfIazip2UkN4VjCtGyonVGw/viewform?usp=publish-editor"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={close}
                      className="flex align-items-center gap-050"
                    >
                      <Bug size={16} />
                      <span>Report a problem</span>
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://github.com/web3senior/hupsocial"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={close}
                      className="flex align-items-center gap-050"
                    >
                      <Code size={16} />
                      <span>GitHub</span>
                    </a>
                  </li>
                  <li>
                    <a href="/help" target="_blank" rel="noopener noreferrer" onClick={close} className="flex align-items-center gap-050">
                      <HelpCircle size={16} />
                      <span>Help</span>
                    </a>
                  </li>
                </ul>
              </div>
            )}
          </NativePopover>

          <Link
            href="/chains"
            className={clsx(styles.link, isActivePath(pathname, '/chains') && styles.linkActive)}
            title={isCompact ? 'Networks' : undefined}
            aria-current={isActivePath(pathname, '/chains') ? 'page' : undefined}
            onClick={closeSidebar}
          >
            <div className={styles.iconWrapper}>
              <LayoutGridIcon
                size={20}
                fill={isActivePath(pathname, '/chains') ? 'currentColor' : 'none'}
                strokeWidth={isActivePath(pathname, '/chains') ? 2 : 1.7}
              />
            </div>
            {!isCompact && <span className={styles.linkText}>Networks</span>}
          </Link>
        </div>
      </div>
    </aside>
  )
}

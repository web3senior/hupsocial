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
  MessageSquareWarning,
  Monitor,
  Boxes,
  Moon,
  Palette,
  PanelRightClose,
  PanelRightOpen,
  Settings,
  SquareTerminal,
  Sun,
  UserRound,
  Plus,
} from 'lucide-react'

import logo from '@/../public/logo.svg'
import socerBall from '@/../public/socer-ball.svg'
import NewPost from '@/components/NewPost'
import { useClientMounted } from '@/hooks/useClientMount'
import { useSidebarStore } from '@/stores/useSidebarStore'
import NativePopover from './ui/NativePopover'
import styles from './Aside.module.scss'
import { Download } from 'lucide-react'
import { Settings2 } from 'lucide-react'
import { Cpu } from 'lucide-react'
import { CodeXml } from 'lucide-react'
import { Terminal } from 'lucide-react'
import { TerminalSquare } from 'lucide-react'

const NAV_COMPONENTS = {
  'new-post': NewPost,
}

const themeOptions = [
  { id: 'system', icon: <Settings2 size={16} /> },
  { id: 'dark', icon: <Moon size={16} /> },
  { id: 'light', icon: <Sun size={16} /> },
  { id: 'terminal', icon: <TerminalSquare size={16} /> },
]

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

const NavLink = ({ item, isActive, isCompact, batchCount, onNavigate }) => {
  const isComponentOpen = useSidebarStore((state) => state.isComponentOpen)
  const setIsComponentOpen = useSidebarStore((state) => state.setIsComponentOpen)

  if (item.type === 'divider') {
    return <hr className={styles.divider} aria-hidden="true" />
  }

  const Icon = item.icon ?? Circle
  const Component = typeof item.component === 'string' ? NAV_COMPONENTS[item.component] : item.component

  // Match target item flags against common dynamic identifier properties
  const isBatchLikeItem = item.id === 'batch-like' || item.path === '/batch-like' || item.name === 'Batch Like'

  const content = (
    <>
      <div className={styles.iconWrapper} data-icon={item.name}>
        <Icon size={20} fill={isActive ? 'currentColor' : 'none'} strokeWidth={isActive ? 2 : 1.5} />

        {/* Render a tiny alert badge overlay over icon when sidebar is tightly compact */}
        {isBatchLikeItem && isCompact && batchCount > 0 && <span className={styles.compactBadgeDot} aria-hidden="true" />}
      </div>
      {!isCompact && <span className={styles.linkText}>{item.name}</span>}

      {/* Render full numeric indicator tag layout when sidebar is wide/expanded */}
      {isBatchLikeItem && !isCompact && batchCount > 0 && <span className={styles.badgeCounter}>{batchCount}</span>}
    </>
  )

  if (Component) {
    return (
      <>
        <button
          type="button"
          className={clsx(styles.link, styles.moreButton)}
          aria-label={item.name}
          data-tooltip={isCompact ? item.name : undefined}
          onClick={() => {
            setIsComponentOpen(true)
            onNavigate?.()
          }}
        >
          {content}
        </button>

        {isComponentOpen && <Component item={item} onClose={() => setIsComponentOpen(false)} />}
      </>
    )
  }

  return (
    <Link
      href={item.path}
      className={clsx(styles.link, isActive && styles.linkActive)}
      aria-label={item.name}
      data-tooltip={isCompact ? item.name : undefined}
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

  const getNavItems = useSidebarStore((state) => state.getNavItems)

  // Safe item fallback array structure avoids runtime evaluation crash errors
  const navItems = getNavItems() ?? []
  const isMenuOpen = useSidebarStore((state) => state.isMenuOpen)
  const toggleMenu = useSidebarStore((state) => state.toggleMenu)
  const toggleMobileMenu = useSidebarStore((state) => state.toggleMobileMenu)
  const closeMenu = useSidebarStore((state) => state.closeMenu)
  const isMobileMenuOpen = useSidebarStore((state) => state.isMobileMenuOpen)
  const closeMobileMenu = useSidebarStore((state) => state.closeMobileMenu)
  const setIsComponentOpen = useSidebarStore((state) => state.setIsComponentOpen)

  // Extract network-mapped queue states to calculate aggregated metrics safely
  const likedPostIdsMap = useSidebarStore((state) => state.likedPostIds ?? {})

  // Safely accumulate the total item count across all active chain networks
  const batchCount = useMemo(() => {
    if (Array.isArray(likedPostIdsMap)) {
      return likedPostIdsMap.length
    }
    return Object.values(likedPostIdsMap).reduce((acc, currentArray) => {
      return acc + (Array.isArray(currentArray) ? currentArray.length : 0)
    }, 0)
  }, [likedPostIdsMap])

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
              <Image src={socerBall} alt="World Cup" className={styles.logoWrapper__ball} />
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
              <NavLink
                item={item}
                isActive={isActivePath(pathname, item.path)}
                isCompact={isCompact}
                batchCount={batchCount}
                onNavigate={closeSidebar}
              />
            </li>
          ))}
        </ul>

        <div className={styles.footerNav}>
          <NativePopover
            trigger={
              <button
                type="button"
                className={clsx(styles.link, styles.moreButton)}
                aria-label="More"
                data-tooltip={isCompact ? 'More' : undefined}
              >
                <div className={styles.iconWrapper}>
                  <Equal size={24} />
                </div>
                {!isCompact && <span className={styles.linkText}>More</span>}
              </button>
            }
            placement="right-end"
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
                    <div className={styles.themeWrapper}>
                      <div className="flex align-items-center gap-050">
                        <Palette size={16} />
                        <span>Theme</span>
                      </div>
                      <div className={clsx(styles.themeItems, 'grid grid--fit grid--gap-025')} style={{ '--data-width': '30px' }}>
                        {themeOptions.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            aria-pressed={theme === option.id}
                            onClick={() => setTheme(option.id)}
                            className={clsx(theme === option.id && styles.active)}
                          >
                            {option.icon}
                          </button>
                        ))}
                      </div>
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
                    <Link href="/help" onClick={close} className="flex align-items-center gap-050">
                      <MessageSquareWarning size={16} />
                      <span>Send feedback</span>
                    </Link>
                  </li>
                  <li>
                    <Link href="/help" onClick={close} className="flex align-items-center gap-050">
                      <Bug size={16} />
                      <span>Report a problem</span>
                    </Link>
                  </li>
                  <li>
                    <Link href="/install" onClick={close} className="flex align-items-center gap-050">
                      <Download size={16} />
                      <span>Install {process.env.NEXT_PUBLIC_NAME}</span>
                    </Link>
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
                    <Link href="/help" onClick={close} className="flex align-items-center gap-050">
                      <HelpCircle size={16} />
                      <span>Help</span>
                    </Link>
                  </li>
                </ul>
              </div>
            )}
          </NativePopover>

          <Link
            href="/networks"
            className={clsx(styles.link, isActivePath(pathname, '/networks') && styles.linkActive)}
            aria-label="Networks"
            data-tooltip={isCompact ? 'Networks' : undefined}
            aria-current={isActivePath(pathname, '/networks') ? 'page' : undefined}
            onClick={closeSidebar}
          >
            <div className={styles.iconWrapper}>
              <Boxes
                size={20}
                fill={isActivePath(pathname, '/networks') ? 'currentColor' : 'none'}
                strokeWidth={isActivePath(pathname, '/networks') ? 2 : 1.7}
              />
            </div>
            {!isCompact && <span className={styles.linkText}>Networks</span>}
          </Link>
        </div>
      </div>

      {pathname !== '/chat' && (
        <div className={styles.floatingActions}>
          {batchCount > 0 && (
            <Link
              href="/batch-like"
              className={clsx(styles.floatingActions__button, styles['floatingActions__button--batch'])}
              aria-label={`View batch queue with ${batchCount} operations`}
            >
              <Heart size={20} fill="var(--batch-like-color, #facc15)" stroke="var(--batch-like-color, #facc15)" />
              <span className={styles.floatingActions__badge}>{batchCount}</span>
            </Link>
          )}

          <button
            className={clsx(styles.floatingActions__button, styles['floatingActions__button--new'])}
            onClick={() => setIsComponentOpen(true)}
            aria-label="Create new post"
          >
            <Plus />
          </button>
        </div>
      )}
    </aside>
  )
}

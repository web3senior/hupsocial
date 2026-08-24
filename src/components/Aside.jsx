'use client'

import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useConnection } from 'wagmi'
import clsx from 'clsx'
import { BookIcon, BugIcon, CaretDoubleLeftIcon, CaretDoubleRightIcon, ChatCenteredDotsIcon, DownloadSimpleIcon, EqualsIcon, FadersHorizontalIcon, GasPumpIcon, GearIcon, HandCoinsIcon, HeartIcon, MoonIcon, PaletteIcon, PlusIcon, QuestionIcon, RobotIcon, SunIcon, TerminalWindowIcon } from '@phosphor-icons/react'
import { CircleIcon, StackIcon, UserIcon } from '@phosphor-icons/react'
import logo from '@/../public/logo.svg'
import NewPost from '@/components/NewPost'
import { toast } from '@/components/NextToast'
import { useClientMounted } from '@/hooks/useClientMount'
import { useProfile } from '@/hooks/useProfile'
import { useSidebarStore } from '@/stores/useSidebarStore'
import { usePostStore } from '@/stores/usePostStore'
import BatchLikeTrigger from './BatchLikeTrigger'
import NativePopover from './ui/NativePopover'
import { handleBrokenAvatar } from '@/lib/utils'
import { GitHub } from './Icons'
import styles from './Aside.module.scss'

const NAV_COMPONENTS = {
  'new-post': NewPost,
}

const themeOptions = [
  { id: 'system', icon: <FadersHorizontalIcon size={16} /> },
  { id: 'dark', icon: <MoonIcon size={16} /> },
  { id: 'light', icon: <SunIcon size={16} /> },
  { id: 'terminal', icon: <TerminalWindowIcon size={16} /> },
]

const isActivePath = (pathname, path) => {
  if (!pathname || !path) return false
  if (path === '/') return pathname === '/'
  return pathname === path || pathname.startsWith(`${path}/`)
}

// A section row links to one route but owns several (config/sections.js), so it has
// to stay lit on any of them — plain `path` matching would drop the highlight the
// moment the user moved to a sibling tab.
const isActiveItem = (pathname, item) =>
  isActivePath(pathname, item.path) || Boolean(item.activePaths?.some((path) => isActivePath(pathname, path)))

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
    activePaths: item.activePaths,
    icon: item.icon,
    component: item.component,
  }
}

const NavLink = ({ item, isActive, isCompact, showTooltip, unreadCount, onNavigate, onLinkClick }) => {
  const isComponentOpen = useSidebarStore((state) => state.isComponentOpen)
  const setIsComponentOpen = useSidebarStore((state) => state.setIsComponentOpen)
  const { isConnected } = useConnection()

  if (item.type === 'divider') {
    return <hr className={styles.divider} aria-hidden="true" />
  }

  const Icon = item.icon ?? CircleIcon
  const Component = typeof item.component === 'string' ? NAV_COMPONENTS[item.component] : item.component

  // Match target item flags against common dynamic identifier properties
  const isChatItem = item.id === 'chat' || item.path === '/chat' || item.name === 'Chat'
  const isNotificationItem = item.id === 'notifications' || item.path === '/notifications' || item.name === 'Notifications'

  const content = (
    <>
      <div className={styles.iconWrapper} data-icon={item.name}>
        {item.avatarSrc ? (
          <Image
            className={clsx(styles.navAvatar, isActive && styles.navAvatarActive)}
            src={item.avatarSrc}
            alt=""
            width={20}
            height={20}
            unoptimized
            onError={handleBrokenAvatar}
          />
        ) : (
          <Icon size={20} weight={isActive ? 'fill' : 'regular'} />
        )}

        {/* Render a tiny alert badge overlay over icon when sidebar is tightly compact */}
        {isNotificationItem && isCompact && unreadCount > 0 && <span className={styles.notificationBadgeDot} aria-hidden="true" />}
      </div>
      {!isCompact && <span className={styles.linkText}>{item.name}</span>}

      {isChatItem && !isCompact && <span className={styles.betaBadge}></span>}

      {/* Render full numeric indicator tag layout when sidebar is wide/expanded */}
      {isNotificationItem && !isCompact && unreadCount > 0 && (
        <span className={styles.notificationBadgeCounter}>{unreadCount > 99 ? '99+' : unreadCount}</span>
      )}
    </>
  )

  if (Component) {
    return (
      <>
        <button
          type="button"
          className={clsx(styles.link, styles.moreButton)}
          aria-label={item.name}
          data-tooltip={showTooltip ? item.name : undefined}
          onClick={() => {
            // The composer can only publish with a wallet behind it — say so here rather than
            // letting the author write a whole post into a dialog that cannot submit
            if (!isConnected) {
              toast('Please connect wallet', 'error')
              return
            }
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
      data-tooltip={showTooltip ? item.name : undefined}
      aria-current={isActive ? 'page' : undefined}
      onClick={(event) => {
        onLinkClick?.(event)
        onNavigate?.()
      }}
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
  const claimLegacyBatch = useSidebarStore((state) => state.claimLegacyBatch)

  // Safe item fallback array structure avoids runtime evaluation crash errors
  const navItems = getNavItems(address) ?? []
  const isMenuOpen = useSidebarStore((state) => state.isMenuOpen)
  const toggleMenu = useSidebarStore((state) => state.toggleMenu)
  const toggleMobileMenu = useSidebarStore((state) => state.toggleMobileMenu)
  const closeMenu = useSidebarStore((state) => state.closeMenu)
  const isMobileMenuOpen = useSidebarStore((state) => state.isMobileMenuOpen)
  const closeMobileMenu = useSidebarStore((state) => state.closeMobileMenu)
  const setIsComponentOpen = useSidebarStore((state) => state.setIsComponentOpen)

  // Hand any pre-wallet basket over to the first wallet that connects
  useEffect(() => {
    if (isConnected && address) claimLegacyBatch(address)
  }, [isConnected, address, claimLegacyBatch])

  const { data: notifData, mutate: revalidateUnread } = useSWR(
    // `filter=inbox` counts only what other people did — the same set the notifications page
    // opens on, so the badge always clears by reading the feed.
    isConnected && address ? `/api/v1/notifications?wallet_address=${address}&filter=inbox&limit=1` : null,
    (url) => fetch(url).then((r) => r.json()),
    { refreshInterval: 60_000, revalidateOnFocus: true }
  )
  const unreadCount = notifData?.success ? (notifData.meta?.unread_count ?? 0) : 0

  // Client-side navigation fires no focus event and never remounts the layout, so without this the
  // badge only moves on the 60s poll tick.
  useEffect(() => {
    revalidateUnread()
  }, [pathname, revalidateUnread])

  const [isWideScreen, setIsWideScreen] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia('(min-width: 768px)')

    setIsWideScreen(mql.matches)

    const handleChange = (event) => setIsWideScreen(event.matches)
    mql.addEventListener('change', handleChange)

    return () => mql.removeEventListener('change', handleChange)
  }, [])

  // Only fetch a profile once a wallet is connected — the disconnected state keeps the plain icon
  const { profile } = useProfile(isConnected && address ? address : null)

  const navLinks = useMemo(() => {
    const profilePath = isConnected && address ? `/${address}` : '/connect'

    return [
      ...navItems.map(normalizeNavItem).filter((item) => item.type === 'divider' || item.path || item.component),
      {
        id: 'profile',
        name: 'Profile',
        path: profilePath,
        icon: UserIcon,
        avatarSrc: isConnected && address ? profile?.profileImage : null,
      },
    ]
  }, [address, isConnected, navItems, profile?.profileImage])

  const isMobileLayout = !isWideScreen
  const isExpanded = isMobileLayout ? isMobileMenuOpen : isMenuOpen
  const isCompact = !isExpanded
  const shouldShowMobileMenu = isMobileLayout && isMobileMenuOpen
  const closeSidebar = isMobileLayout ? closeMobileMenu : closeMenu

  const [tooltipReady, setTooltipReady] = useState(false)

  useEffect(() => {
    if (!isCompact) {
      setTooltipReady(false)
      return
    }
    // Wait for sidebar close transition to finish (0.1s delay + 0.3s transition)
    const t = setTimeout(() => setTooltipReady(true), 420)
    return () => clearTimeout(t)
  }, [isCompact])

  const handleToggleMenu = () => {
    if (isMobileLayout) {
      toggleMobileMenu()
    } else {
      toggleMenu()
    }
  }

  const requestFeedRefresh = usePostStore((state) => state.requestFeedRefresh)

  // Home link double-duty: scrolled down -> back to top, already at top -> pull fresh posts
  const handleHomeLinkClick = (event) => {
    if (pathname !== '/') return

    event.preventDefault()

    if (document.documentElement.scrollTop > 0) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      requestFeedRefresh()
    }
  }

  if (!mounted) {
    return <aside className={styles.aside} style={{ width: '250px' }} />
  }

  return (
    <aside
      className={clsx(
        styles.aside,
        !isMobileLayout && (isExpanded ? styles.expanded : styles.compact),
        shouldShowMobileMenu && styles.show,
        shouldShowMobileMenu && styles.expanded
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
              <CaretDoubleLeftIcon size={18} />
            </button>
          )}

          <button
            type="button"
            className={clsx(styles.menuButton, styles.menuButtonFloat)}
            onClick={handleToggleMenu}
            aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-expanded={isExpanded}
          >
            {isExpanded ? <CaretDoubleLeftIcon size={18} /> : <CaretDoubleRightIcon size={18} />}
          </button>
        </header>

        <ul className={styles.navList}>
          {navLinks.map((item, index) => (
            <li key={item.id ?? `${item.type}-${index}`}>
              <NavLink
                item={item}
                isActive={isActiveItem(pathname, item)}
                isCompact={isCompact}
                showTooltip={tooltipReady}
                unreadCount={unreadCount}
                onNavigate={isMobileLayout ? closeSidebar : undefined}
                onLinkClick={item.id === 'foryou' ? handleHomeLinkClick : undefined}
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
                  <EqualsIcon size={24} />
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
                      <GearIcon size={16} />
                      <span>Settings</span>
                    </Link>
                  </li>
                  <li>
                    <Link href="/liked" onClick={close} className="flex align-items-center gap-050">
                      <HeartIcon size={16} />
                      <span>Liked</span>
                    </Link>
                  </li>
                  <li>
                    <Link href="/nfts/offers" onClick={close} className="flex align-items-center gap-050">
                      <HandCoinsIcon size={16} />
                      <span>My offers</span>
                    </Link>
                  </li>
                  <li>
                    <Link href="/gas" onClick={close} className="flex align-items-center gap-050">
                      <GasPumpIcon size={16} />
                      <span>Gas tank</span>
                    </Link>
                  </li>
                  <li>
                    <div className={styles.themeWrapper}>
                      <div className="flex align-items-center gap-050">
                        <PaletteIcon size={16} />
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
                      <BookIcon size={16} />
                      <span>Documentation</span>
                    </a>
                  </li>
                  <li>
                    <a
                      href="/llms.txt"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={close}
                      className="flex align-items-center gap-050"
                    >
                      <RobotIcon size={16} />
                      <span>llms.txt</span>
                    </a>
                  </li>
                  <li>
                    <Link href="/help" onClick={close} className="flex align-items-center gap-050">
                      <ChatCenteredDotsIcon size={16} />
                      <span>Send feedback</span>
                    </Link>
                  </li>
                  <li>
                    <Link href="/help" onClick={close} className="flex align-items-center gap-050">
                      <BugIcon size={16} />
                      <span>Report a problem</span>
                    </Link>
                  </li>
                  <li>
                    <Link href="/install" onClick={close} className="flex align-items-center gap-050">
                      <DownloadSimpleIcon size={16} />
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
                      <GitHub />
                      <span>GitHub</span>
                    </a>
                  </li>
                  <li>
                    <Link href="/help" onClick={close} className="flex align-items-center gap-050">
                      <QuestionIcon size={16} />
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
            data-tooltip={tooltipReady ? 'Networks' : undefined}
            aria-current={isActivePath(pathname, '/networks') ? 'page' : undefined}
            onClick={closeSidebar}
          >
            <div className={styles.iconWrapper}>
              <StackIcon size={20} weight={isActivePath(pathname, '/networks') ? 'fill' : 'regular'} />
            </div>
            {!isCompact && <span className={styles.linkText}>Networks</span>}
          </Link>
        </div>
      </div>

      {pathname !== '/chat' && (
        <div className={styles.floatingActions}>
          <BatchLikeTrigger className={styles.floatingActions__button} badgeClassName={styles.floatingActions__badge} />

          <button
            className={clsx(styles.floatingActions__button, styles['floatingActions__button--new'])}
            onClick={() => {
              if (!isConnected) {
                toast('Please connect wallet', 'error')
                return
              }
              setIsComponentOpen(true)
            }}
            aria-label="Create new post"
          >
            <PlusIcon />
          </button>
        </div>
      )}
    </aside>
  )
}

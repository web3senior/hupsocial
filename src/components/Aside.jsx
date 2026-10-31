'use client'

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import useSWR from 'swr'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useActiveWallet } from '@/hooks/useActiveWallet'
import clsx from 'clsx'
import { CircleIcon, EqualsIcon, PlusIcon, UserIcon, XIcon } from '@phosphor-icons/react'
import logo from '@/../public/logo.svg'
import NewPost from '@/components/NewPost'
import { toast } from '@/components/NextToast'
import { useClientMounted } from '@/hooks/useClientMount'
import { useFaviconBadge } from '@/hooks/useFaviconBadge'
import { useTitleBadge } from '@/hooks/useTitleBadge'
import { useProfile } from '@/hooks/useProfile'
import { profilePath } from '@/lib/username'
import { MORE_NAV_ITEMS_SCHEMA, useSidebarStore } from '@/stores/useSidebarStore'
import { usePostStore } from '@/stores/usePostStore'
import { openConnect } from '@/lib/connectDialog'
import BatchLikeTrigger from './BatchLikeTrigger'
import Hupi from './hupi/Hupi'
import MoreMenu from './MoreMenu'
import NativeDialog from './ui/NativeDialog'
import Tooltip from './ui/Tooltip'
import NavBadge from './ui/NavBadge'
import Avatar from './ui/Avatar'
import styles from './Aside.module.scss'

// A visible tab revalidates on focus and on every client-side navigation, so its tick only has to
// cover a reader sitting still on one page. A hidden tab polls for one reason — raising the
// favicon badge — and nobody is waiting on it, so it ticks far more slowly.
const subscribeViewport = (onChange) => {
  const query = window.matchMedia('(min-width: 768px) and (max-width: 1023px)')
  window.addEventListener('resize', onChange)
  query.addEventListener('change', onChange)
  return () => {
    window.removeEventListener('resize', onChange)
    query.removeEventListener('change', onChange)
  }
}
const getViewport = () => window.innerWidth < 768 ? 'mobile' : window.innerWidth < 1024 ? 'tablet' : 'desktop'
const getServerViewport = () => 'desktop'

const NOTIFICATION_POLL_MS = 120_000
const HIDDEN_NOTIFICATION_POLL_MS = 300_000

const NAV_COMPONENTS = {
  'new-post': NewPost,
}

// Inline pills a nav item can opt into via `badge` in the store. Colors are theme tokens
// (Globals.scss defines each pair per theme), so nothing here changes per theme.
const NAV_BADGES = {
  beta: { label: 'BETA', background: 'var(--beta-badge-background)', color: 'var(--beta-badge-color)' },
  new: { label: 'NEW', background: 'var(--new-badge-background)', color: 'var(--new-badge-color)' },
  'new-orange': { label: 'NEW', background: 'var(--new-orange-badge-background)', color: 'var(--new-orange-badge-color)' },
}

// Captions for the groups that follow each store divider — the expanded rail labels its
// sections instead of drawing a rule between them.
const SECTION_LABELS = {
  'divider-primary': 'Explore',
  'divider-secondary': 'Your space',
}

// Split the flat nav list on its dividers so each group renders as its own section
const groupNavItems = (items) => items.reduce((groups, item) => {
  if (item.type === 'divider') {
    groups.push({ id: item.id, label: SECTION_LABELS[item.id], items: [] })
  } else {
    groups[groups.length - 1].items.push(item)
  }
  return groups
}, [{ id: 'primary', items: [] }]).filter((group) => group.items.length > 0)

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
    badge: item.badge,
  }
}

const NavLink = ({ item, isActive, isCompact, showTooltip, unreadCount, onNavigate, onLinkClick }) => {
  const setIsComponentOpen = useSidebarStore((state) => state.setIsComponentOpen)
  // The wallet for the active network: a Solana wallet on a Solana cluster, EVM elsewhere
  const { isConnected: canCompose } = useActiveWallet()

  if (item.type === 'divider') {
    return <hr className={styles.divider} aria-hidden="true" />
  }

  const Icon = item.icon ?? CircleIcon
  const Component = typeof item.component === 'string' ? NAV_COMPONENTS[item.component] : item.component

  // Match target item flags against common dynamic identifier properties
  const badge = NAV_BADGES[item.badge]
  const isNotificationItem = item.id === 'notifications' || item.path === '/notifications' || item.name === 'Notifications'

  const content = (
    <>
      <div className={styles.iconWrapper} data-icon={item.name}>
        {item.avatarSrc !== undefined ? (
          <Avatar
            className={clsx(styles.navAvatar, isActive && styles.navAvatarActive)}
            src={item.avatarSrc}
            size={20}
          />
        ) : (
          <Icon size={20} weight={isActive ? 'fill' : 'regular'} />
        )}

        {/* Render a tiny alert badge overlay over icon when sidebar is tightly compact */}
        {isNotificationItem && isCompact && unreadCount > 0 && <span className={styles.notificationBadgeDot} aria-hidden="true" />}
      </div>
      {!isCompact && <span className={styles.linkText}>{item.name}</span>}

      {badge && !isCompact && <NavBadge label={badge.label} background={badge.background} color={badge.color} />}

      {/* Render full numeric indicator tag layout when sidebar is wide/expanded */}
      {isNotificationItem && !isCompact && unreadCount > 0 && (
        <span className={styles.notificationBadgeCounter}>{unreadCount > 99 ? '99+' : unreadCount}</span>
      )}
    </>
  )

  if (Component) {
    return (
      <>
        <Tooltip content={showTooltip ? item.name : null} placement="right" size="compact" hoverOnly>
          <button
            type="button"
            className={clsx(styles.link, styles.moreButton)}
            aria-label={item.name}
            onClick={() => {
              // The composer can only publish with a wallet behind it — offer the chooser here
              // rather than letting the author write a whole post into a dialog that cannot submit
              if (!canCompose) {
                if (!openConnect()) toast('Please connect wallet', 'error')
                return
              }
              setIsComponentOpen(true)
              onNavigate?.()
            }}
          >
            {content}
          </button>
        </Tooltip>
      </>
    )
  }

  return (
    <Tooltip content={showTooltip ? item.name : null} placement="right" size="compact" hoverOnly>
      <Link
        href={item.path}
        prefetch={item.prefetch}
        className={clsx(styles.link, isActive && styles.linkActive)}
        aria-label={item.name}
        aria-current={isActive ? 'page' : undefined}
        onClick={(event) => {
          onLinkClick?.(event)
          onNavigate?.()
        }}
      >
        {content}
      </Link>
    </Tooltip>
  )
}

export default function Aside({ inLayoutGrid = false }) {
  const pathname = usePathname()
  // Identity follows the active network (hooks/useActiveWallet): profile link, avatar and
  // the notification badge all belong to the wallet that signs on this network
  const { address, isConnected } = useActiveWallet()
  const canCompose = isConnected
  const mounted = useClientMounted()

  const getNavItems = useSidebarStore((state) => state.getNavItems)
  const claimLegacyBatch = useSidebarStore((state) => state.claimLegacyBatch)

  // Safe item fallback array structure avoids runtime evaluation crash errors
  const navItems = useMemo(() => getNavItems(address) ?? [], [getNavItems, address])
  const isMenuOpen = useSidebarStore((state) => state.isMenuOpen)
  const isMobileMenuOpen = useSidebarStore((state) => state.isMobileMenuOpen)
  const closeMobileMenu = useSidebarStore((state) => state.closeMobileMenu)
  const isComponentOpen = useSidebarStore((state) => state.isComponentOpen)
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
    // refreshWhenHidden keeps the poll alive in a background tab — without it the favicon badge
    // could never appear while the user is away. SWR re-reads a function interval on each tick,
    // which is what lets the hidden tab hold the badge without polling at the visible rate.
    {
      refreshInterval: () => (typeof document !== 'undefined' && document.hidden ? HIDDEN_NOTIFICATION_POLL_MS : NOTIFICATION_POLL_MS),
      revalidateOnFocus: true,
      refreshWhenHidden: true,
    }
  )
  const unreadCount = notifData?.success ? (notifData.meta?.unread_count ?? 0) : 0

  useFaviconBadge(unreadCount)
  useTitleBadge(unreadCount)

  // Client-side navigation fires no focus event and never remounts the layout, so without this the
  // badge only moves on the poll tick.
  useEffect(() => {
    revalidateUnread()
  }, [pathname, revalidateUnread])

  const viewport = useSyncExternalStore(subscribeViewport, getViewport, getServerViewport)
  const isWideScreen = viewport !== 'mobile'
  const isTablet = viewport === 'tablet'
  const drawerRef = useRef(null)

  const navLinks = useMemo(() => navItems
    .map(normalizeNavItem)
    .filter((item) => item.id !== 'profile' && (item.type === 'divider' || item.path || item.component)), [navItems])
  const hasWallet = Boolean(isConnected && address)
  const { profile } = useProfile(hasWallet ? address : null)

  // Profile closes the account group (after Money): the connected wallet's picture and page, or
  // the connect flow for a signed-out visitor
  const profileItem = useMemo(() => (hasWallet
    ? { id: 'profile', name: 'Profile', path: profilePath(address, profile?.username), avatarSrc: profile?.profileImage ?? '' }
    : { id: 'profile', name: 'Profile', path: '/connect', icon: UserIcon, prefetch: false }
  ), [hasWallet, address, profile?.username, profile?.profileImage])

  const navGroups = useMemo(() => {
    const groups = groupNavItems(navLinks)
    const last = groups[groups.length - 1]
    return last
      ? [...groups.slice(0, -1), { ...last, items: [...last.items, profileItem] }]
      : [{ id: 'primary', items: [profileItem] }]
  }, [navLinks, profileItem])

  const isMobileLayout = !isWideScreen
  const isExpanded = isMobileLayout || (!isTablet && isMenuOpen)
  const isCompact = !isExpanded
  const shouldShowMobileMenu = isMobileLayout && isMobileMenuOpen
  const closeSidebar = closeMobileMenu

  useEffect(() => {
    closeMobileMenu()
  }, [pathname, isWideScreen, closeMobileMenu])

  useEffect(() => {
    if (mounted && shouldShowMobileMenu) drawerRef.current?.open()
    else drawerRef.current?.close()
  }, [mounted, shouldShowMobileMenu])

  // How much of the viewport's left edge this sidebar actually owns, published as
  // --aside-width on the root element so CSS can size against the real footprint instead of
  // assuming the widest state (the NFT Market's card does — see MarketViews.module.scss,
  // which used to pin a ghost 250px gap beside a compact sidebar and shove the page right).
  // A ResizeObserver publishes the actual rendered width, including padding and borders,
  // so consumers follow the sidebar's footprint. Nothing here re-renders — the value goes
  // straight to a custom property. On the mobile layout the element parks off-canvas at its
  // full width, so what it owns is zero. Before mount the placeholder renders untracked and
  // the property stays unset — consumers fall back to the expanded width, which is exactly
  // what the placeholder shows.
  const asideRef = useRef(null)

  useEffect(() => {
    const root = document.documentElement
    const aside = asideRef.current
    if (!aside) return undefined

    if (isMobileLayout) {
      root.style.setProperty('--aside-width', '0px')
      return () => root.style.removeProperty('--aside-width')
    }

    const publish = () => root.style.setProperty('--aside-width', `${aside.getBoundingClientRect().width}px`)
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(aside)

    return () => {
      observer.disconnect()
      root.style.removeProperty('--aside-width')
    }
  }, [isMobileLayout, mounted])

  const tooltipReady = isCompact

  // The scrollbar thumb is transparent at rest and only painted while the list is hovered or
  // scrolling (SCSS). Scroll fires per frame, so the class is toggled on the element directly
  // instead of through state — re-rendering the whole nav 60 times a second buys nothing.
  const navListRef = useRef(null)
  const scrollIdleTimer = useRef(null)

  const handleNavListScroll = () => {
    const list = navListRef.current
    if (!list) return
    list.classList.add(styles.navListScrolling)
    clearTimeout(scrollIdleTimer.current)
    scrollIdleTimer.current = setTimeout(() => list.classList.remove(styles.navListScrolling), 600)
  }

  useEffect(() => () => clearTimeout(scrollIdleTimer.current), [])

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
    return <aside className={clsx(styles.aside, styles['aside--placeholder'], inLayoutGrid && styles['aside--grid'])} aria-hidden="true" />
  }

  const isMoreActive = MORE_NAV_ITEMS_SCHEMA.some((item) => isActiveItem(pathname, item))

  const renderMoreMenu = (trigger, placement) => <MoreMenu trigger={trigger} placement={placement} />

  const SidebarSurface = isMobileLayout ? NativeDialog : 'aside'
  const surfaceProps = isMobileLayout ? {
    ref: drawerRef,
    lightDismiss: true,
    onCancel: (event) => event.stopPropagation(),
    onClose: (event) => {
      event.stopPropagation()
      closeMobileMenu()
    },
  } : { ref: asideRef }

  return (
    <>
      <SidebarSurface
        {...surfaceProps}
        id="main-sidebar"
        aria-label="Main menu"
        className={clsx(styles.aside, inLayoutGrid && styles['aside--grid'], isMobileLayout ? styles.aside__drawer : (isExpanded ? styles.expanded : styles.compact))}
      >
        <div className={styles.navContainer}>
          <header className={styles.header}>
            <div className={styles.logoWrapper}>
              <Link href="/" className="flex align-items-center gap-025" aria-label="Home">
                <Image src={logo} alt={`${process.env.NEXT_PUBLIC_NAME || 'Hup'} logo`} width={24} height={24} priority />
                {isExpanded && <span className={styles.logoCap}>hup.social</span>}
              </Link>
            </div>

            {isExpanded && (
              <div className={styles.header__actions}>
                {renderMoreMenu(
                  <button type="button" className={clsx(styles.header__button, isMoreActive && styles['header__button--active'])} aria-label="More">
                    <EqualsIcon size={20} aria-hidden="true" />
                  </button>,
                  'bottom-start'
                )}

                {isMobileLayout && (
                  <button type="button" className={styles.header__button} onClick={closeMobileMenu} aria-label="Close menu">
                    <XIcon size={20} aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
          </header>

          <div className={styles.navList} ref={navListRef} onScroll={handleNavListScroll}>
            {navGroups.map((group, groupIndex) => (
              <section key={group.id} className={styles.navSection} aria-label={group.label}>
                {group.label && (isExpanded
                  ? <h2 className={styles.navSection__label}>{group.label}</h2>
                  : <hr className={styles.divider} aria-hidden="true" />)}

                <ul className={styles.navSection__list}>
                  {group.items.map((item) => (
                    <li key={item.id}>
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

                  {/* The compact rail has no header room, so More rides at the end of the list */}
                  {isCompact && groupIndex === navGroups.length - 1 && (
                    <li>
                      {renderMoreMenu(
                        <Tooltip content={tooltipReady ? 'More' : null} placement="right" size="compact" hoverOnly>
                          <button type="button" className={clsx(styles.link, styles.moreButton, isMoreActive && styles.linkActive)} aria-label="More">
                            <div className={styles.iconWrapper}>
                              <EqualsIcon size={20} />
                            </div>
                          </button>
                        </Tooltip>,
                        'right-end'
                      )}
                    </li>
                  )}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </SidebarSurface>

      {/* The composer must stay outside the drawer that closes when Post is tapped. */}
      {isComponentOpen && <NewPost onClose={() => setIsComponentOpen(false)} />}

      <div className={styles.floatingActions}>
        <Hupi className={styles.floatingActions__button} />

        <BatchLikeTrigger className={styles.floatingActions__button} badgeClassName={styles.floatingActions__badge} />

        <button
          className={styles.floatingActions__button}
          onClick={() => {
            if (!canCompose) {
              if (!openConnect()) toast('Please connect wallet', 'error')
              return
            }
            setIsComponentOpen(true)
          }}
          aria-label="Create new post"
        >
          <PlusIcon/>
        </button>
      </div>
    </>
  )
}

'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useDisconnect } from 'wagmi'
import clsx from 'clsx'
import { ArrowLeftIcon, ArticleIcon, BookIcon, BridgeIcon, CalendarDotsIcon, CaretRightIcon, ChatCenteredDotsIcon, DownloadSimpleIcon, FadersHorizontalIcon, GasPumpIcon, HardDrivesIcon, HeadCircuitIcon, HeartIcon, MoonIcon, QuestionIcon, RobotIcon, ScrollIcon, SealCheckIcon, ShieldCheckIcon, StackIcon, SunIcon, TerminalWindowIcon } from '@phosphor-icons/react'
import { useActiveWallet } from '@/hooks/useActiveWallet'
import { MORE_NAV_ITEMS_SCHEMA } from '@/stores/useSidebarStore'
import { useSolanaWalletStore } from '@/stores/useSolanaWalletStore'
import NativePopover from './ui/NativePopover'
import { GitHub } from './Icons'
import styles from './MoreMenu.module.scss'

const THEME_OPTIONS = [
  { id: 'system', label: 'Auto', icon: FadersHorizontalIcon },
  { id: 'light', label: 'Light', icon: SunIcon },
  { id: 'dark', label: 'Dark', icon: MoonIcon },
  { id: 'terminal', label: 'Terminal', icon: TerminalWindowIcon },
]

// Sub-pages reachable from the root menu. Link lists render as rows; Appearance is custom.
const SUBMENUS = {
  explore: {
    title: 'Explore',
    items: [
      ...MORE_NAV_ITEMS_SCHEMA,
      { id: 'networks', name: 'Networks', path: '/networks', icon: StackIcon },
      { id: 'bridge', name: 'LUKSO Bridge', path: '/bridge', icon: BridgeIcon },
    ],
  },
  activity: {
    title: 'Your activity',
    items: [
      { id: 'liked', name: 'Liked', path: '/liked', icon: HeartIcon },
      { id: 'scheduled', name: 'Scheduled posts', path: '/scheduled', icon: CalendarDotsIcon },
      { id: 'write', name: 'Write an article', path: '/compose/article', icon: ArticleIcon },
      { id: 'gas', name: 'Gas tank', path: '/gas', icon: GasPumpIcon },
      { id: 'premium', name: 'Premium', path: '/premium', icon: SealCheckIcon },
    ],
  },
  appearance: { title: 'Appearance' },
  resources: {
    title: 'Resources',
    items: [
      { id: 'help', name: 'Help', path: '/help', icon: QuestionIcon },
      { id: 'feedback', name: 'Send feedback', path: '/help', icon: ChatCenteredDotsIcon },
      { id: 'docs', name: 'Documentation', href: 'https://docs.hup.social', icon: BookIcon },
      { id: 'agents', name: 'AI agents', path: '/agents', icon: HeadCircuitIcon },
      { id: 'llms', name: 'llms.txt', href: '/llms.txt', icon: RobotIcon },
      { id: 'github', name: 'GitHub', href: 'https://github.com/web3senior/hupsocial', icon: GitHub },
      { id: 'status', name: 'System status', path: '/status', icon: HardDrivesIcon },
      { id: 'install', name: `Install ${process.env.NEXT_PUBLIC_NAME}`, path: '/install', icon: DownloadSimpleIcon },
      { id: 'terms', name: 'Terms of use', path: '/terms', icon: ScrollIcon },
      { id: 'privacy', name: 'Privacy Policy', path: '/privacy-policy', icon: ShieldCheckIcon },
    ],
  },
}

const isActivePath = (pathname, path) => Boolean(path) && (pathname === path || pathname?.startsWith(`${path}/`))

/**
 * Sidebar "More" popover: a short grouped root menu whose `>` rows drill into a
 * sub-page with a back button. One NativePopover; `view` swaps the rendered level
 * (same pattern as AddTabMenu) instead of nesting popovers.
 */
export default function MoreMenu({ trigger, placement }) {
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()
  const { isConnected, kind } = useActiveWallet()
  const { disconnect: disconnectEvm } = useDisconnect()
  const disconnectSolana = useSolanaWalletStore((state) => state.disconnect)
  const popoverRef = useRef(null)
  const panelRef = useRef(null)
  const lastSubmenu = useRef(null)
  const [view, setView] = useState('root')

  // A level change resizes the panel, so re-anchor it, and keep keyboard focus inside:
  // the back button on a sub-page, the row that opened it on the way back
  useLayoutEffect(() => {
    popoverRef.current?.reposition()
    const panel = panelRef.current
    if (!panel || !panel.closest(':popover-open')) return
    const target = view === 'root'
      ? panel.querySelector(`[data-submenu="${lastSubmenu.current}"]`)
      : panel.querySelector('[data-back]')
    target?.focus()
  }, [view])

  const openSubmenu = (id) => {
    lastSubmenu.current = id
    setView(id)
  }

  const handleDisconnect = async (close) => {
    close()
    if (kind === 'solana') await disconnectSolana()
    else disconnectEvm()
  }

  const submenu = SUBMENUS[view]

  return (
    <NativePopover
      ref={popoverRef}
      trigger={trigger}
      placement={placement}
      type="auto"
      onToggle={(event) => {
        if (event.newState === 'closed') {
          lastSubmenu.current = null
          setView('root')
        }
      }}
    >
      {({ close }) => (
        <div ref={panelRef} className={styles['more-menu']}>
          {view === 'root' && (
            <>
              <div className={styles['more-menu__group']}>
                {/* The ambassador program, one tap from the top rather than inside Explore: it is
                    how strangers are recruited, so it should not take a drill-down to find */}
                <Link
                  href="/hupsters"
                  onClick={close}
                  className={clsx(styles['more-menu__row'], isActivePath(pathname, '/hupsters') && styles['more-menu__row--active'])}
                  aria-current={isActivePath(pathname, '/hupsters') ? 'page' : undefined}
                >
                  Hupsters
                </Link>
                <SubmenuRow id="explore" label="Explore" onOpen={openSubmenu} />
                <SubmenuRow id="activity" label="Your activity" onOpen={openSubmenu} />
                <SubmenuRow id="appearance" label="Appearance" onOpen={openSubmenu} />
                <Link href="/settings" onClick={close} className={styles['more-menu__row']}>Settings</Link>
              </div>

              <div className={styles['more-menu__group']}>
                <SubmenuRow id="resources" label="Resources" onOpen={openSubmenu} />
                <Link href="/help" onClick={close} className={styles['more-menu__row']}>Report a problem</Link>
              </div>

              {isConnected && (
                <div className={styles['more-menu__group']}>
                  <button
                    type="button"
                    className={clsx(styles['more-menu__row'], styles['more-menu__row--danger'])}
                    onClick={() => handleDisconnect(close)}
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </>
          )}

          {submenu && (
            <>
              <header className={styles['more-menu__header']}>
                <button type="button" data-back className={styles['more-menu__back']} onClick={() => setView('root')} aria-label="Back">
                  <ArrowLeftIcon size={20} />
                </button>
                <p className={styles['more-menu__title']}>{submenu.title}</p>
              </header>

              {view === 'appearance' ? (
                <div className={styles['more-menu__themes']} role="group" aria-label="Theme">
                  {THEME_OPTIONS.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={theme === id}
                      className={clsx(styles['more-menu__theme'], theme === id && styles['more-menu__theme--active'])}
                      onClick={() => setTheme(id)}
                    >
                      <Icon size={18} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <ul className={styles['more-menu__list']}>
                  {submenu.items.map(({ id, name, path, href, icon: Icon }) => {
                    const isActive = isActivePath(pathname, path)
                    const content = (
                      <>
                        <Icon size={18} weight={isActive ? 'fill' : 'regular'} />
                        <span>{name}</span>
                      </>
                    )
                    return (
                      <li key={id}>
                        {href ? (
                          <a href={href} target="_blank" rel="noopener noreferrer" onClick={close} className={styles['more-menu__row']}>
                            {content}
                          </a>
                        ) : (
                          <Link
                            href={path}
                            onClick={close}
                            className={clsx(styles['more-menu__row'], isActive && styles['more-menu__row--active'])}
                            aria-current={isActive ? 'page' : undefined}
                          >
                            {content}
                          </Link>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </NativePopover>
  )
}

function SubmenuRow({ id, label, onOpen }) {
  return (
    <button type="button" data-submenu={id} className={styles['more-menu__row']} onClick={() => onOpen(id)}>
      <span className={styles['more-menu__label']}>{label}</span>
      <CaretRightIcon size={16} className={styles['more-menu__caret']} />
    </button>
  )
}

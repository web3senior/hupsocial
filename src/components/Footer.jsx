'use client'

import React, { useMemo } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useConnection } from 'wagmi'
import { BellIcon, ChatCircleIcon, HouseIcon, MagnifyingGlassIcon, PlusIcon } from '@phosphor-icons/react'
import clsx from 'clsx'

import { toast } from '@/components/NextToast'
import { useClientMounted } from '@/hooks/useClientMount'
import { useScrollDim } from '@/hooks/useScrollDim'
import { useScrollChrome } from '@/hooks/useScrollChrome'
import { useSidebarStore } from '@/stores/useSidebarStore'
import { usePostStore } from '@/stores/usePostStore'
import { useChatDockStore } from '@/stores/useChatDockStore'
import { openConnect } from '@/lib/connectDialog'
import styles from './Footer.module.scss'

// Helper function synced with Aside to track active sub-routes accurately
const isActivePath = (pathname, path) => {
  if (!pathname || !path) return false
  if (path === '/') return pathname === '/'
  return pathname === path || pathname.startsWith(`${path}/`)
}

export default function Footer() {
  const mounted = useClientMounted()
  // The bar dims to a faint outline the moment you browse downward and returns on the way up
  const isDimmed = useScrollDim()
  const pathname = usePathname()
  const { isConnected } = useConnection()

  // Pull global sidebar states to match functional action layers
  const setIsComponentOpen = useSidebarStore((state) => state.setIsComponentOpen)
  const requestFeedRefresh = usePostStore((state) => state.requestFeedRefresh)

  // The chat room is a tab here rather than a floating pill (components/chat/ChatDock)
  const chatMode = useChatDockStore((state) => state.mode)
  const chatUnread = useChatDockStore((state) => state.unread)
  const openChat = useChatDockStore((state) => state.open)
  const minimizeChat = useChatDockStore((state) => state.minimize)
  const isChatOpen = chatMode !== 'minimized'
  const chromeRef = useScrollChrome(isDimmed && !isChatOpen, mounted, 'bottom')

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

  const navLinks = useMemo(() => {
    return [
      { name: 'Home', path: '/', icon: HouseIcon },
      { name: 'Search', path: '/search', icon: MagnifyingGlassIcon },
      {
        name: 'New',
        // Same gate as the sidebar: no wallet, no composer
        action: () => {
          if (!isConnected) {
            if (!openConnect()) toast('Please connect wallet', 'error')
            return
          }
          setIsComponentOpen(true)
        },
        icon: PlusIcon,
      },
      { name: 'Notifications', path: '/notifications', icon: BellIcon },
      {
        name: 'Chat',
        action: () => (isChatOpen ? minimizeChat() : openChat()),
        icon: ChatCircleIcon,
        isActive: isChatOpen,
        hasDot: chatUnread > 0,
      },
    ]
  }, [isConnected, setIsComponentOpen, isChatOpen, chatUnread, openChat, minimizeChat])

  // The open room covers the page, so leaving for another tab has to put it away
  const closeChatOnNavigate = () => {
    if (isChatOpen) minimizeChat()
  }

  if (!mounted) return null

  return (
    // The open room is seated above the bar and closes from it, so the bar stays while it is open
    <footer ref={chromeRef} className={styles.footer}>
      <nav className={styles['footer__bar']} aria-label="Mobile Navigation">
        <ul className={styles['footer__list']}>
          {navLinks.map((item, index) => {
            const Icon = item.icon
            // While the room is open it owns the screen, so only the Chat tab reads as selected
            const isActive = item.path ? !isChatOpen && isActivePath(pathname, item.path) : Boolean(item.isActive)

            // Filled icons mark the active tab. Names live on aria-label / title.
            const itemContent = (
              <span className={styles['footer__icon']} data-icon={item.name}>
                <Icon size={24} weight={isActive ? 'fill' : 'regular'} />
                {item.hasDot && <span className={styles['footer__dot']} aria-hidden="true" />}
              </span>
            )

            // Render functional action wrapper if item triggers component modals (like New Post)
            if (item.action) {
              return (
                <li key={`action-${index}`} className={styles['footer__item']}>
                  <button
                    type="button"
                    className={clsx(styles['footer__link'], isActive && styles['footer__link--active'])}
                    onClick={item.action}
                    aria-label={item.hasDot ? `${item.name}, unread messages` : item.name}
                    title={item.name}
                    aria-pressed={item.isActive === undefined ? undefined : isActive}
                  >
                    {itemContent}
                  </button>
                </li>
              )
            }

            // Normal Navigation Links
            return (
              <li key={item.path} className={styles['footer__item']}>
                <Link
                  href={item.path}
                  className={clsx(styles['footer__link'], isActive && styles['footer__link--active'])}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={item.hasDot ? `${item.name}, unread messages` : item.name}
                  title={item.name}
                  onClick={(event) => {
                    closeChatOnNavigate()
                    if (item.path === '/') handleHomeLinkClick(event)
                  }}
                >
                  {itemContent}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </footer>
  )
}

'use client'

import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useConnection } from 'wagmi'
import { HouseIcon, PaperPlaneTiltIcon, PlayCircleIcon, PlusIcon, UserIcon } from '@phosphor-icons/react'
import clsx from 'clsx'

import { toast } from '@/components/NextToast'
import { useClientMounted } from '@/hooks/useClientMount'
import { useSidebarStore } from '@/stores/useSidebarStore'
import { usePostStore } from '@/stores/usePostStore'
import { useChatDockStore } from '@/stores/useChatDockStore'
import { openConnect } from '@/lib/connectDialog'
import styles from './Footer.module.scss'

// Gesture tuning for the auto-hide. Below the jitter floor a scroll is trackpad noise or a
// rubber-band settle; above the jump ceiling it is not a gesture at all but a restored or
// anchored position, which must not flick the bar away.
const SCROLL_JITTER = 8
const SCROLL_JUMP = 300
// The bar always shows this close to the top, so a page opens with it in view
const SCROLL_REVEAL_ZONE = 64

// Helper function synced with Aside to track active sub-routes accurately
const isActivePath = (pathname, path) => {
  if (!pathname || !path) return false
  if (path === '/') return pathname === '/'
  return pathname === path || pathname.startsWith(`${path}/`)
}

export default function Footer() {
  const mounted = useClientMounted()
  // One UI hides the bar the moment you browse downward and hands it back on the way up
  const [isHidden, setIsHidden] = useState(false)
  const pathname = usePathname()
  const { address, isConnected } = useConnection()

  // Pull global sidebar states to match functional action layers
  const setIsComponentOpen = useSidebarStore((state) => state.setIsComponentOpen)
  const requestFeedRefresh = usePostStore((state) => state.requestFeedRefresh)

  // The chat room is a tab here rather than a floating pill (components/chat/ChatDock)
  const chatMode = useChatDockStore((state) => state.mode)
  const chatUnread = useChatDockStore((state) => state.unread)
  const openChat = useChatDockStore((state) => state.open)
  const minimizeChat = useChatDockStore((state) => state.minimize)
  const isChatOpen = chatMode !== 'minimized'

  useEffect(() => {
    let lastY = window.scrollY
    let frame = 0

    const evaluate = () => {
      frame = 0
      const y = window.scrollY
      const delta = y - lastY

      // A cached feed position replayed on return (tabs/HomeFeedTab) or an anchor jump lands as
      // one huge delta. Re-anchor on it, but read no intent into it.
      if (Math.abs(delta) > SCROLL_JUMP) {
        lastY = y
        return
      }

      // Hold the anchor through sub-threshold moves so a slow drag still accumulates into one
      if (Math.abs(delta) < SCROLL_JITTER) return

      setIsHidden(delta > 0 && y > SCROLL_REVEAL_ZONE)
      lastY = y
    }

    // Scroll fires far faster than paint; collapse a burst into the one frame that shows
    const handleScroll = () => {
      if (!frame) frame = requestAnimationFrame(evaluate)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      window.removeEventListener('scroll', handleScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  // A new route starts at the top, so the bar owes the user a clean slate
  useEffect(() => {
    setIsHidden(false)
  }, [pathname])

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
    const profilePath = isConnected && address ? `/${address}` : '/connect'

    return [
      { name: 'Home', path: '/', icon: HouseIcon },
      { name: 'Shorts', path: '/shorts', icon: PlayCircleIcon },
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
      // The /chat page is the onchain messenger and hides the dock, so the tab would open nothing there
      pathname !== '/chat' && {
        name: 'Chat',
        action: () => (isChatOpen ? minimizeChat() : openChat()),
        icon: PaperPlaneTiltIcon,
        isActive: isChatOpen,
        hasDot: chatUnread > 0,
      },
      { name: 'Profile', path: profilePath, icon: UserIcon },
    ].filter(Boolean)
  }, [address, isConnected, setIsComponentOpen, pathname, isChatOpen, chatUnread, openChat, minimizeChat])

  // The open room covers the page, so leaving for another tab has to put it away
  const closeChatOnNavigate = () => {
    if (isChatOpen) minimizeChat()
  }

  if (!mounted) return null

  return (
    // The open room is seated above the bar and closes from it, so the bar stays while it is open
    <footer className={clsx(styles.footer, isHidden && !isChatOpen && styles['footer--hidden'])}>
      <nav className={styles['footer__bar']} aria-label="Mobile Navigation">
        <ul className={styles['footer__list']}>
          {navLinks.map((item, index) => {
            const Icon = item.icon
            // While the room is open it owns the screen, so only the Chat tab reads as selected
            const isActive = item.path ? !isChatOpen && isActivePath(pathname, item.path) : Boolean(item.isActive)

            // One UI keeps the same outline glyph in both states and only thickens the
            // selected one — the pill and the brighter label carry the rest
            const itemContent = (
              <>
                <span className={styles['footer__icon']} data-icon={item.name}>
                  <Icon size={24} weight={isActive ? 'bold' : 'regular'} />
                  {item.hasDot && <span className={styles['footer__dot']} aria-hidden="true" />}
                </span>
                <span className={styles['footer__label']}>{item.name}</span>
              </>
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

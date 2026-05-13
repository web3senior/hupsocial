'use client'

import React, { useState, useMemo, useEffect, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useConnection } from 'wagmi'
import {
  House,
  Plus,
  Search,
  Users,
  Trophy,
  Calendar,
  Briefcase,
  LayoutGrid,
  Heart,
  Bookmark,
  UserRound,
  Equal,
} from 'lucide-react'
import logo from '@/../public/hup.svg'
import clsx from 'clsx'
import styles from './Aside.module.scss'
import { LayoutGridIcon } from 'lucide-react'

const NAV_ITEMS = [
  { name: 'Onchain', path: '/', icon: House },
  { name: 'New post', path: '/new', icon: Plus },
  { name: 'Search', path: '/search', icon: Search },
  { name: 'br' },
  { name: 'Communities', path: '/community', icon: Users },
  { name: 'Leaderboard', path: '/leaderboard', icon: Trophy },
  { name: 'Events', path: '/events', icon: Calendar },
  { name: 'Jobs', path: '/jobs', icon: Briefcase },
  { name: 'Apps', path: '/apps', icon: LayoutGrid },
  { name: 'br' },
  { name: 'Activity', path: '/activity', icon: Heart },
  { name: 'Saved', path: '/saved', icon: Bookmark },
]

const NavLink = ({ item, isActive, isCompact }) => {
  const { name, path, icon: Icon } = item
  if (name === 'br') return <hr className={styles.divider} />

  return (
    <Link
      href={path}
      className={clsx(styles.link, isActive && styles.linkActive)}
      title={isCompact ? name : undefined}
    >
      <div className={styles.iconWrapper}>
        <Icon
          size={20}
          fill={isActive ? 'currentColor' : 'none'}
          strokeWidth={isActive ? 2 : 1.7}
        />
      </div>
      {!isCompact && <span className={styles.linkText}>{name}</span>}
    </Link>
  )
}

export default function Aside() {
  const pathname = usePathname()
  const { address, isConnected } = useConnection()

  // State for media query and hover
  const [isWideScreen, setIsWideScreen] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Ref to hold the timer ID
  const hoverTimeoutRef = useRef(null)

  useEffect(() => {
    setMounted(true)
    const mql = window.matchMedia('(min-width: 1150px)')

    // Set initial state
    setIsWideScreen(mql.matches)

    // Listener for resize events
    const handleChange = (e) => setIsWideScreen(e.matches)
    mql.addEventListener('change', handleChange)

    return () => mql.removeEventListener('change', handleChange)
  }, [])

  const navLinks = useMemo(() => {
    const profilePath = isConnected && address ? `/${address}` : '/connect'
    return [...NAV_ITEMS, { name: 'Profile', path: profilePath, icon: UserRound }]
  }, [address, isConnected])

  // Handle Mouse Enter with Delay
  const handleMouseEnter = () => {
    // 200ms delay is usually the "sweet spot" for intent
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(true)
    }, 200)
  }

  // Handle Mouse Leave (Cancel the timer)
  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
    }
    setIsHovered(false)
  }

  // Determine if we should show the full labels
  // Show full if: (Screen > 1150px) OR (Hovered)
  const isExpanded = isWideScreen || isHovered

  // Prevent hydration mismatch by not rendering dynamic parts until mounted
  if (!mounted) return <aside className={styles.aside} style={{ width: '68px' }} />

  return (
    <aside
      className={clsx(styles.aside, isExpanded ? styles.expanded : styles.compact)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className={styles.navContainer}>
        <div className={styles.logoWrapper}>
          <Image src={logo} alt={`${process.env.NEXT_PUBLIC_NAME || 'Hup'} logo`} width={28} height={28} priority />
          {isExpanded && (
            <span className={styles.logoCap}>{process.env.NEXT_PUBLIC_NAME || 'Hup'}</span>
          )}
        </div>

        <ul className={styles.navList}>
          {navLinks.map((item, i) => (
            <li key={i}>
              <NavLink item={item} isActive={pathname === item.path} isCompact={!isExpanded} />
            </li>
          ))}
        </ul>

        <div className={styles.footerNav}>
          <div className={styles.more}>
            <div className={styles.link}>
              <div className={styles.iconWrapper}>
                <Equal size={24} />
              </div>
              {isExpanded && <span className={styles.linkText}>More</span>}
            </div>
          </div>

          <Link
            href={`/networks`}
            className={clsx(styles.link, pathname === `/networks` && styles.linkActive)}
            title={`Networks`}
          >
            <div className={styles.iconWrapper}>
              <LayoutGridIcon
                size={20}
                fill={pathname === `/networks` ? 'currentColor' : 'none'}
                strokeWidth={pathname === `/networks` ? 2 : 1.7}
              />
            </div>
            {isExpanded && <span className={styles.linkText}>Networks</span>}
          </Link>
        </div>
      </div>
    </aside>
  )
}

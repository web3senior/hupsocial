'use client'

import React, { useMemo } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAccount } from 'wagmi' 
import { Heart, UserRound, Search, House, Plus } from 'lucide-react'
import { useClientMounted } from '@/hooks/useClientMount'
import styles from './Footer.module.scss'

const NAV_ITEMS = [
  { name: 'Home', path: '/', icon: House },
  { name: 'Search', path: '/inbox', icon: Search },
  { name: 'New', path: '/new', icon: Plus },
  { name: 'Activity', path: '/activity', icon: Heart },
]

export default function Footer() {
  const mounted = useClientMounted()
  const pathname = usePathname()
  const { address, isConnected } = useAccount()

  const navLinks = useMemo(() => {
    const profilePath = isConnected && address ? `/u/${address}` : '/connect'
    return [...NAV_ITEMS, { name: 'Profile', path: profilePath, icon: UserRound }]
  }, [address, isConnected])

  if (!mounted) return null

  return (
    <footer className={styles.footer}>
      <nav aria-label="Mobile Navigation">
        <ul>
          {navLinks.map(({ name, path, icon: Icon }) => {
            const isActive = pathname === path
            return (
              <li key={path}>
                <Link
                  href={path}
                  className={styles.link}
                  data-active={isActive}
                  aria-label={name}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon
                    size={24}
                    // strokeWidth 0 when active creates a "bold" filled look 
                    // if the icon has a fill, otherwise use 2.5
                    strokeWidth={isActive ? 2.5 : 1.5}
                    fill={isActive ? 'currentColor' : 'none'}
                  />
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </footer>
  )
}
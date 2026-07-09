'use client'

import React, { useMemo } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useConnection } from 'wagmi'
import { HeartIcon, HouseIcon, MagnifyingGlassIcon, PlusIcon, UserIcon } from '@phosphor-icons/react'
import clsx from 'clsx'

import { useClientMounted } from '@/hooks/useClientMount'
import { useSidebarStore } from '@/stores/useSidebarStore'
import styles from './Footer.module.scss'

// Helper function synced with Aside to track active sub-routes accurately
const isActivePath = (pathname, path) => {
  if (!pathname || !path) return false
  if (path === '/') return pathname === '/'
  return pathname === path || pathname.startsWith(`${path}/`)
}

export default function Footer() {
  const mounted = useClientMounted()
  const pathname = usePathname()
  const { address, isConnected } = useConnection()

  // Pull global sidebar states to match functional action layers
  const setIsComponentOpen = useSidebarStore((state) => state.setIsComponentOpen)
  const likedPostIdsMap = useSidebarStore((state) => state.likedPostIds ?? {})

  // Sync batch calculation exactly with the Aside metric tracking
  const batchCount = useMemo(() => {
    if (Array.isArray(likedPostIdsMap)) {
      return likedPostIdsMap.length
    }
    return Object.values(likedPostIdsMap).reduce((acc, currentArray) => {
      return acc + (Array.isArray(currentArray) ? currentArray.length : 0)
    }, 0)
  }, [likedPostIdsMap])

  const navLinks = useMemo(() => {
    const profilePath = isConnected && address ? `/${address}` : '/connect'

    return [
      { name: 'Home', path: '/', icon: HouseIcon },
      { name: 'Search', path: '/search', icon: MagnifyingGlassIcon },
      { name: 'New', action: () => setIsComponentOpen(true), icon: PlusIcon },
      { name: 'Notifications', path: '/batch-like', icon: HeartIcon, isBatch: true },
      { name: 'Profile', path: profilePath, icon: UserIcon },
    ]
  }, [address, isConnected, setIsComponentOpen])

  if (!mounted) return null

  return (
    <footer className={styles.footer}>
      <nav aria-label="Mobile Navigation">
        <ul>
          {navLinks.map((item, index) => {
            const Icon = item.icon
            const isActive = item.path ? isActivePath(pathname, item.path) : false

            const iconContent = (
              <div className={styles.iconWrapper} data-icon={item.name}>
                <Icon size={24} weight={isActive && item.name !== 'Search' ? 'fill' : 'regular'} />
                {/* Dynamically append badge if item is tracking batch counts */}
                {item.isBatch && batchCount > 0 && <span className={styles.compactBadgeDot} aria-hidden="true" />}
              </div>
            )

            // Render functional action wrapper if item triggers component modals (like New Post)
            if (item.action) {
              return (
                <li key={`action-${index}`}>
                  <button type="button" className={styles.link} onClick={item.action} aria-label={item.name}>
                    {iconContent}
                  </button>
                </li>
              )
            }

            // Normal Navigation Links
            return (
              <li key={item.path}>
                <Link
                  href={item.path}
                  className={clsx(styles.link, isActive && styles.linkActive)}
                  aria-label={item.name}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {iconContent}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </footer>
  )
}

'use client'

import React, { useMemo } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import logo from '@/../public/hup.svg'
import { useConnection } from 'wagmi'
import { Heart, UserRound, Search, House, Plus } from 'lucide-react'
import { useClientMounted } from '@/hooks/useClientMount'
import styles from './Aside.module.scss'

const NAV_ITEMS = [
  { name: 'Home', path: '/', icon: House },
  { name: 'Search', path: '/search', icon: Search },
  { name: 'New', path: '/new', icon: Plus },
  { name: 'Activity', path: '/activity', icon: Heart },
]

export default function Aside() {
  const mounted = useClientMounted()
  const pathname = usePathname()
  const { address, isConnected } = useConnection()

  const navLinks = useMemo(() => {
    const profilePath = isConnected && address ? `/u/${address}` : '/connect'

    return [...NAV_ITEMS, { name: 'Profile', path: profilePath, icon: UserRound }]
  }, [address, isConnected])

  // Prevent hydration mismatch
  if (!mounted) return null

  return (
    <aside className={`${styles.aside}`}>
      <Link href={`/new`} className={styles.newButton}>
        <Plus />
      </Link>

      <nav className={`d-f-c flex-column align-items-center`} aria-label="Main Navigation">
        <Link href={`/`} className={`${styles.logo}`}>
          <Image src={logo} alt={`${process.env.NEXT_PUBLIC_NAME} Logo`} width={32} height={32} />
        </Link>

        {/* Navigation Links */}
        <ul className="d-f-c flex-column gap-1">
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
                  title={name}
                >
                  <Icon
                    size={24}
                    strokeWidth={isActive ? 0 : 2.2}
                    fill={isActive && name !== 'Search' ? 'currentColor' : 'none'}
                  />
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </aside>
  )
}

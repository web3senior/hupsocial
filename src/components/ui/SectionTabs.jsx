'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import { SECTIONS } from '@/config/sections'
import styles from './SectionTabs.module.scss'

/**
 * Sub-navigation for the routes bundled under one sidebar row (config/sections.js).
 * Sits between the page title and the page's own container, and carries its own
 * container so every section page lines the strip up with the content below it
 * without repeating the wrapper. Links rather than buttons: every tab is a real
 * page, so middle-click, open-in-new-tab and a plain reload all keep working.
 */
export default function SectionTabs({ section, className }) {
  const pathname = usePathname() ?? ''
  const config = SECTIONS[section]

  if (!config) return null

  return (
    <div className={clsx('__container', styles.sectionTabs, className)} data-width="medium">
      <nav className={styles.sectionTabs__nav} aria-label={`${config.name} sections`}>
        <ul className={styles.sectionTabs__list}>
          {config.tabs.map((tab) => {
            // Prefix match so detail routes (/nfts/offers, /drops/[id]) keep their tab lit
            const isActive = pathname === tab.path || pathname.startsWith(`${tab.path}/`)

            return (
              <li key={tab.id} className={styles.sectionTabs__item}>
                <Link
                  href={tab.path}
                  className={clsx(styles.sectionTabs__tab, isActive && styles['sectionTabs__tab--active'])}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {tab.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}

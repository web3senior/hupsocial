'use client'

import { useMemo } from 'react'
import clsx from 'clsx'
import { XIcon } from '@phosphor-icons/react'
import { useRouter } from 'next/navigation'
import { useConnection } from 'wagmi'
import { useHomeTabsStore, resolveTabs } from '@/stores/useHomeTabsStore'
import AddTabMenu from './AddTabMenu'
import styles from './HomeTabStrip.module.scss'

// These render icon-only in the strip (matches Threads: utility tabs are icon
// buttons, feed tabs carry a text label).
const ICON_ONLY_TYPES = ['search', 'notifications', 'profile']

export default function HomeTabStrip() {
  const tabs = useHomeTabsStore((state) => state.tabs)
  const resolvedTabs = useMemo(() => resolveTabs(tabs), [tabs])
  const activeTabId = useHomeTabsStore((state) => state.activeTabId)
  const setActiveTab = useHomeTabsStore((state) => state.setActiveTab)
  const removeTab = useHomeTabsStore((state) => state.removeTab)
  const router = useRouter()
  const { address, isConnected } = useConnection()

  // Profile has no inline content in this pass - it navigates to the existing
  // wallet route instead of becoming the active tab (see plan's MVP decision).
  const handleTabClick = (tab) => {
    if (tab.type === 'profile') {
      router.push(isConnected && address ? `/${address}` : '/connect')
      return
    }
    setActiveTab(tab.id)
  }

  return (
    <div className={styles['tab-strip']}>
      <div className={styles['tab-strip__scroll']}>
        {resolvedTabs.map((tab) => {
          const Icon = tab.icon
          const isActive = tab.id === activeTabId
          const iconOnly = ICON_ONLY_TYPES.includes(tab.type)

          return (
            <button
              key={tab.id}
              type="button"
              className={clsx(styles['tab-strip__tab'], isActive && styles['tab-strip__tab--active'])}
              onClick={() => handleTabClick(tab)}
              aria-current={isActive ? 'true' : undefined}
            >
              {tab.type === 'network' && tab.chainIcon && (
                <span className={styles['tab-strip__chain-icon']}>
                  <img src={tab.chainIcon} alt="" />
                </span>
              )}
              {Icon && <Icon size={18} />}
              {!iconOnly && <span className={styles['tab-strip__label']}>{tab.label}</span>}

              {tab.id !== 'foryou' && (
                <span
                  className={styles['tab-strip__remove']}
                  role="button"
                  aria-label={`Remove ${tab.label} tab`}
                  onClick={(e) => {
                    e.stopPropagation()
                    removeTab(tab.id)
                  }}
                >
                  <XIcon size={12} />
                </span>
              )}
            </button>
          )
        })}
      </div>

      <AddTabMenu />
    </div>
  )
}

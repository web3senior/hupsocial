'use client'

import { useMemo } from 'react'
import clsx from 'clsx'
import { CaretDownIcon, CheckIcon, XIcon } from '@phosphor-icons/react'
import { useHomeTabsStore, resolveTabs } from '@/stores/useHomeTabsStore'
import NativePopover from '@/components/ui/NativePopover'
import AddTabMenu from './AddTabMenu'
import styles from './HomeTabStrip.module.scss'

// Threads-style feed heading: the active tab's name is the page title, and tapping it lists
// the other tabs to switch to. Adding tabs stays with AddTabMenu at the row's end.
export default function HomeTabStrip() {
  const tabs = useHomeTabsStore((state) => state.tabs)
  const resolvedTabs = useMemo(() => resolveTabs(tabs), [tabs])
  const activeTabId = useHomeTabsStore((state) => state.activeTabId)
  const setActiveTab = useHomeTabsStore((state) => state.setActiveTab)
  const removeTab = useHomeTabsStore((state) => state.removeTab)

  const activeTab = resolvedTabs.find((tab) => tab.id === activeTabId) ?? resolvedTabs[0]

  return (
    <div className={styles['tab-strip']}>
      <NativePopover
        placement="bottom-start"
        type="auto"
        trigger={
          <button type="button" className={styles['tab-strip__heading']} aria-label="Switch feed">
            <TabIcon tab={activeTab} />
            <h1 className={styles['tab-strip__title']}>{activeTab?.label}</h1>
            <CaretDownIcon size={16} weight="bold" className={styles['tab-strip__caret']} />
          </button>
        }
      >
        {({ close }) => (
          <div className={styles['tab-strip__menu']}>
            {resolvedTabs.map((tab) => {
              const isActive = tab.id === activeTabId

              return (
                <div key={tab.id} className={clsx(styles['tab-strip__item'], isActive && styles['tab-strip__item--active'])}>
                  <button
                    type="button"
                    className={styles['tab-strip__switch']}
                    aria-current={isActive ? 'true' : undefined}
                    onClick={() => {
                      setActiveTab(tab.id)
                      close()
                    }}
                  >
                    <TabIcon tab={tab} />
                    <span className={styles['tab-strip__label']}>{tab.label}</span>
                    {isActive && <CheckIcon size={16} className={styles['tab-strip__check']} />}
                  </button>

                  {tab.id !== 'foryou' && (
                    <button
                      type="button"
                      className={styles['tab-strip__remove']}
                      aria-label={`Remove ${tab.label} tab`}
                      onClick={() => removeTab(tab.id)}
                    >
                      <XIcon size={14} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </NativePopover>

      <AddTabMenu />
    </div>
  )
}

function TabIcon({ tab }) {
  if (!tab) return null

  if (tab.type === 'network' && tab.chainIcon) {
    return (
      <span className={styles['tab-strip__chain-icon']}>
        <img src={tab.chainIcon} alt="" />
      </span>
    )
  }

  const Icon = tab.icon
  return Icon ? <Icon size={18} /> : null
}

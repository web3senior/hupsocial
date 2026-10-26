'use client'

import { useEffect, useMemo, useRef } from 'react'
import clsx from 'clsx'
import { XIcon } from '@phosphor-icons/react'
import { useHomeTabsStore, resolveTabs, FIXED_TAB_IDS } from '@/stores/useHomeTabsStore'
import AddTabMenu from './AddTabMenu'
import styles from './HomeTabStrip.module.scss'

// Feed row: For you and Following lead, the reader's added feeds follow in one horizontal
// scroller, and AddTabMenu stays pinned at the row's end. An added feed shows its remove
// button once it is the active one, so the row stays calm.
export default function HomeTabStrip() {
  const tabs = useHomeTabsStore((state) => state.tabs)
  const resolvedTabs = useMemo(() => resolveTabs(tabs), [tabs])
  const activeTabId = useHomeTabsStore((state) => state.activeTabId)
  const setActiveTab = useHomeTabsStore((state) => state.setActiveTab)
  const removeTab = useHomeTabsStore((state) => state.removeTab)
  const scrollerRef = useRef(null)

  // Keep the active feed in view, e.g. one just added from the menu lands off the right edge
  useEffect(() => {
    // Scrolls the row only; scrollIntoView would also move the page and fight feed restoration
    const scroller = scrollerRef.current
    const active = scroller?.querySelector('[aria-selected="true"]')?.parentElement
    if (!active) return

    const start = active.offsetLeft - scroller.offsetLeft
    const end = start + active.offsetWidth
    if (start < scroller.scrollLeft) scroller.scrollTo({ left: start, behavior: 'smooth' })
    else if (end > scroller.scrollLeft + scroller.clientWidth) {
      scroller.scrollTo({ left: end - scroller.clientWidth, behavior: 'smooth' })
    }
  }, [activeTabId, tabs.length])

  return (
    <div className={styles['tab-strip']}>
      <div ref={scrollerRef} className={styles['tab-strip__scroller']} role="tablist" aria-label="Feeds">
        {resolvedTabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const isRemovable = !FIXED_TAB_IDS.includes(tab.id)

          return (
            <div key={tab.id} className={clsx(styles['tab-strip__tab'], isActive && styles['tab-strip__tab--active'])}>
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                className={styles['tab-strip__switch']}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.type === 'network' && tab.chainIcon && (
                  <span className={styles['tab-strip__chain-icon']}>
                    <img src={tab.chainIcon} alt="" />
                  </span>
                )}
                <span className={styles['tab-strip__label']}>{tab.label}</span>
              </button>

              {isActive && isRemovable && (
                <button
                  type="button"
                  className={styles['tab-strip__remove']}
                  aria-label={`Remove ${tab.label} feed`}
                  onClick={() => removeTab(tab.id)}
                >
                  <XIcon size={12} weight="bold" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      <AddTabMenu />
    </div>
  )
}

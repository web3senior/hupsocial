'use client'

import { useEffect, useMemo, useRef } from 'react'
import clsx from 'clsx'
import { XIcon } from '@phosphor-icons/react'
import { useHomeTabsStore, resolveTabs } from '@/stores/useHomeTabsStore'
import AddTabMenu from './AddTabMenu'
import styles from './HomeTabStrip.module.scss'

export default function HomeTabStrip() {
  const tabs = useHomeTabsStore((state) => state.tabs)
  const resolvedTabs = useMemo(() => resolveTabs(tabs), [tabs])
  const activeTabId = useHomeTabsStore((state) => state.activeTabId)
  const setActiveTab = useHomeTabsStore((state) => state.setActiveTab)
  const removeTab = useHomeTabsStore((state) => state.removeTab)
  const scrollRef = useRef(null)

  // Mouse wheels only emit vertical deltas, and the strip hides its scrollbar,
  // so on desktop the row is unreachable without this: route deltaY into
  // scrollLeft. Native listener (not React onWheel) because preventDefault
  // needs passive: false.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const onWheel = (e) => {
      if (el.scrollWidth <= el.clientWidth) return
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return

      el.scrollLeft += e.deltaY
      e.preventDefault()
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Mouse drag-to-scroll (touch swiping is native). Pointer capture starts only
  // past a 5px threshold so plain clicks still reach the tab buttons; after a
  // real drag the trailing click is swallowed so it can't activate a tab.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    let pointerId = null
    let startX = 0
    let startLeft = 0
    let dragged = false
    let suppressClick = false

    const onPointerDown = (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      if (el.scrollWidth <= el.clientWidth) return

      pointerId = e.pointerId
      startX = e.clientX
      startLeft = el.scrollLeft
      dragged = false
    }

    const onPointerMove = (e) => {
      if (pointerId === null || e.pointerId !== pointerId) return

      const dx = e.clientX - startX
      if (!dragged) {
        if (Math.abs(dx) < 5) return
        dragged = true
        el.setPointerCapture(pointerId)
      }
      el.scrollLeft = startLeft - dx
    }

    const onPointerUp = (e) => {
      if (pointerId === null || e.pointerId !== pointerId) return

      if (dragged) suppressClick = true
      pointerId = null
      dragged = false
    }

    const onClickCapture = (e) => {
      if (!suppressClick) return
      suppressClick = false
      e.stopPropagation()
      e.preventDefault()
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerUp)
    el.addEventListener('click', onClickCapture, true)

    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerUp)
      el.removeEventListener('click', onClickCapture, true)
    }
  }, [])

  return (
    <div className={styles['tab-strip']}>
      <div ref={scrollRef} className={styles['tab-strip__scroll']}>
        {resolvedTabs.map((tab) => {
          const Icon = tab.icon
          const isActive = tab.id === activeTabId

          return (
            <button
              key={tab.id}
              type="button"
              className={clsx(styles['tab-strip__tab'], isActive && styles['tab-strip__tab--active'])}
              onClick={() => setActiveTab(tab.id)}
              aria-current={isActive ? 'true' : undefined}
            >
              {tab.type === 'network' && tab.chainIcon && (
                <span className={styles['tab-strip__chain-icon']}>
                  <img src={tab.chainIcon} alt="" />
                </span>
              )}
              {Icon && <Icon size={18} />}
              <span className={styles['tab-strip__label']}>{tab.label}</span>

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

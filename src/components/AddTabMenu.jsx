'use client'

import { useState } from 'react'
import { CaretLeftIcon, CaretRightIcon, CheckIcon, GlobeIcon, PlusIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import NativePopover from '@/components/ui/NativePopover'
import { useHomeTabsStore, TAB_TYPE_SCHEMA } from '@/stores/useHomeTabsStore'
import { allAppChains } from '@/lib/chains'
import styles from './AddTabMenu.module.scss'

// Feed types offered in the root menu, in display order (Home is always pinned)
const FEED_TYPES = ['following', 'trending', 'status', 'nft', 'polls']

/**
 * "Add feed" popover: root menu (Following/Trending/Status/NFTs/Polls/Networks)
 * and a Networks submenu (one entry per configured chain). Built on the single
 * NativePopover primitive - `view` swaps the rendered menu level instead of
 * nesting native popovers. Feeds already added stay listed with a check so the
 * menu never silently shrinks.
 */
export default function AddTabMenu() {
  const tabs = useHomeTabsStore((state) => state.tabs)
  const addTab = useHomeTabsStore((state) => state.addTab)
  const setActiveTab = useHomeTabsStore((state) => state.setActiveTab)
  const [view, setView] = useState('root')

  const hasTab = (id) => tabs.some((tab) => tab.id === id)
  const networkCount = tabs.filter((tab) => tab.type === 'network').length

  // Picking a feed that's already added just jumps to it
  const handleSelect = (close, type, meta = {}) => {
    const id = type === 'network' ? `net-${meta.chainId}` : type
    if (hasTab(id)) setActiveTab(id)
    else addTab(type, meta)
    close()
  }

  return (
    <NativePopover
      placement="bottom-end"
      trigger={
        <button type="button" className={styles['add-tab__trigger']} aria-label="Add a feed">
          <PlusIcon size={16} weight="bold" />
          <span className={styles['add-tab__trigger-label']}>Add feed</span>
        </button>
      }
      onToggle={(e) => {
        if (e.newState === 'closed') setView('root')
      }}
    >
      {({ close }) => (
        <div className={styles['add-tab']}>
          {view === 'root' && (
            <>
              <header className={styles['add-tab__header']}>
                <p className={styles['add-tab__title']}>Add a feed</p>
                <p className={styles['add-tab__hint']}>Pinned feeds appear when you tap the title to switch.</p>
              </header>

              {FEED_TYPES.map((type) => {
                const { label, icon, description } = TAB_TYPE_SCHEMA[type]
                return (
                  <MenuItem
                    key={type}
                    icon={icon}
                    label={label}
                    description={description}
                    trailing={hasTab(type) ? <CheckIcon size={16} weight="bold" /> : null}
                    added={hasTab(type)}
                    onClick={() => handleSelect(close, type)}
                  />
                )
              })}

              <MenuItem
                icon={GlobeIcon}
                label="Networks"
                description={networkCount > 0 ? `${networkCount} added · posts from one chain` : 'Posts from one chain'}
                onClick={() => setView('networks')}
                trailing={<CaretRightIcon size={16} />}
              />
            </>
          )}

          {view === 'networks' && (
            <>
              <MenuItem label="Networks" leading={<CaretLeftIcon size={16} />} onClick={() => setView('root')} muted />
              {allAppChains().map((chain) => {
                const added = hasTab(`net-${chain.id}`)
                return (
                  <MenuItem
                    key={chain.id}
                    label={chain.name}
                    leading={
                      <span className={styles['add-tab__chain-icon']}>
                        <img src={chain.iconUrl} alt="" />
                      </span>
                    }
                    trailing={added ? <CheckIcon size={16} weight="bold" /> : null}
                    added={added}
                    onClick={() => handleSelect(close, 'network', { chainId: chain.id })}
                  />
                )
              })}
            </>
          )}
        </div>
      )}
    </NativePopover>
  )
}

function MenuItem({ icon: Icon, label, description, leading, trailing, onClick, added, muted }) {
  return (
    <button
      type="button"
      className={clsx(styles['add-tab__item'], added && styles['add-tab__item--added'], muted && styles['add-tab__item--muted'])}
      onClick={onClick}
    >
      {leading}
      {Icon && (
        <span className={styles['add-tab__icon']}>
          <Icon size={18} />
        </span>
      )}
      <span className={styles['add-tab__text']}>
        <span className={styles['add-tab__label']}>{label}</span>
        {description && <span className={styles['add-tab__description']}>{description}</span>}
      </span>
      {trailing && <span className={styles['add-tab__trailing']}>{trailing}</span>}
    </button>
  )
}

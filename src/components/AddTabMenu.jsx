'use client'

import { useState } from 'react'
import { BroadcastIcon, CaretLeftIcon, CaretRightIcon, CheckIcon, FlameIcon, ListChecksIcon, PlusIcon, StorefrontIcon, UserCheckIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import NativePopover from '@/components/ui/NativePopover'
import { useHomeTabsStore } from '@/stores/useHomeTabsStore'
import { allAppChains } from '@/lib/chains'
import styles from './AddTabMenu.module.scss'

/**
 * Threads-style "Add Tab" popover: root menu (Following/Trending/Status/Networks)
 * and a Networks submenu (one entry per configured chain). Built on the single
 * NativePopover primitive - `view` swaps the rendered menu level instead of
 * nesting native popovers.
 */
export default function AddTabMenu() {
  const tabs = useHomeTabsStore((state) => state.tabs)
  const addTab = useHomeTabsStore((state) => state.addTab)
  const [view, setView] = useState('root')

  const hasTab = (id) => tabs.some((tab) => tab.id === id)
  const hasNetworkTab = (chainId) => tabs.some((tab) => tab.type === 'network' && tab.chainId === chainId)

  const handleSelect = (close, type, meta) => {
    addTab(type, meta)
    close()
  }

  return (
    <NativePopover
      placement="bottom-end"
      trigger={
        <button type="button" className={styles['add-tab__trigger']} aria-label="Add tab">
          <PlusIcon size={20} />
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
              {!hasTab('following') && <MenuItem icon={UserCheckIcon} label="Following" onClick={() => handleSelect(close, 'following')} />}
              {!hasTab('trending') && <MenuItem icon={FlameIcon} label="Trending" onClick={() => handleSelect(close, 'trending')} />}
              {!hasTab('status') && <MenuItem icon={BroadcastIcon} label="Status" onClick={() => handleSelect(close, 'status')} />}
              {!hasTab('nft') && <MenuItem icon={StorefrontIcon} label="NFTs" onClick={() => handleSelect(close, 'nft')} />}
              {!hasTab('polls') && <MenuItem icon={ListChecksIcon} label="Polls" onClick={() => handleSelect(close, 'polls')} />}
              <MenuItem label="Networks" onClick={() => setView('networks')} trailing={<CaretRightIcon size={16} />} />
            </>
          )}

          {view === 'networks' && (
            <>
              <MenuItem label="Back" leading={<CaretLeftIcon size={16} />} onClick={() => setView('root')} muted />
              {allAppChains().map((chain) => {
                const added = hasNetworkTab(chain.id)
                return (
                  <MenuItem
                    key={chain.id}
                    label={chain.name}
                    leading={
                      <span className={styles['add-tab__chain-icon']}>
                        <img src={chain.iconUrl} alt="" />
                      </span>
                    }
                    trailing={added ? <CheckIcon size={16} /> : null}
                    onClick={() => handleSelect(close, 'network', { chainId: chain.id })}
                    disabled={added}
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

function MenuItem({ icon: Icon, label, leading, trailing, onClick, disabled, muted }) {
  return (
    <button
      type="button"
      className={clsx(styles['add-tab__item'], disabled && styles['add-tab__item--disabled'], muted && styles['add-tab__item--muted'])}
      onClick={onClick}
      disabled={disabled}
    >
      {leading}
      {Icon && <Icon size={18} />}
      <span className={styles['add-tab__label']}>{label}</span>
      {trailing && <span className={styles['add-tab__trailing']}>{trailing}</span>}
    </button>
  )
}

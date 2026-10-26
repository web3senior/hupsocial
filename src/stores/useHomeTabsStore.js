'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { BroadcastIcon, FlameIcon, HouseIcon, ListChecksIcon, StorefrontIcon, UserCheckIcon } from '@phosphor-icons/react'
import { config } from '@/config/wagmi'
import { solanaChainFor } from '@/config/solana'

// Static schema for non-network tab types. Icons/labels stay out of localStorage
// (same reasoning as NAV_ITEMS_SCHEMA in useSidebarStore.js) to avoid serialization issues.
export const TAB_TYPE_SCHEMA = {
  foryou: { label: 'For you', icon: HouseIcon, description: 'Posts from every network' },
  following: { label: 'Following', icon: UserCheckIcon, description: 'Only people you follow' },
  trending: { label: 'Trending', icon: FlameIcon, description: 'Most active posts right now' },
  status: { label: 'Status', icon: BroadcastIcon, description: 'Short status updates' },
  nft: { label: 'NFTs', icon: StorefrontIcon, description: 'Mints, listings and collections' },
  polls: { label: 'Polls', icon: ListChecksIcon, description: 'Open polls you can vote on' },
}

// For you and Following always lead the row and can't be removed; added feeds follow them
const DEFAULT_TABS = [
  { id: 'foryou', type: 'foryou' },
  { id: 'following', type: 'following' },
]
export const FIXED_TAB_IDS = DEFAULT_TABS.map((tab) => tab.id)

const networkTabId = (chainId) => `net-${chainId}`

// Plain function (not a store getter) so components can memoize the result.
// Calling this inside a zustand selector would return a fresh array every
// snapshot and trigger React's "maximum update depth exceeded" loop.
export const resolveTabs = (tabs) =>
  tabs.map((tab) => {
    if (tab.type === 'network') {
      const chain = config.chains.find((c) => c.id === tab.chainId) ?? solanaChainFor(tab.chainId)
      return { ...tab, label: chain?.name ?? `Chain ${tab.chainId}`, icon: null, chainIcon: chain?.iconUrl ?? null }
    }
    const schema = TAB_TYPE_SCHEMA[tab.type]
    return { ...tab, label: schema?.label ?? tab.type, icon: schema?.icon ?? null }
  })

export const useHomeTabsStore = create(
  persist(
    (set, get) => ({
      tabs: DEFAULT_TABS,
      activeTabId: 'foryou',

      addTab: (type, meta = {}) => {
        const id = type === 'network' ? networkTabId(meta.chainId) : type

        set((state) => {
          if (state.tabs.some((tab) => tab.id === id)) return state

          const tab = type === 'network' ? { id, type, chainId: meta.chainId } : { id, type }
          return { tabs: [...state.tabs, tab], activeTabId: id }
        })
      },

      removeTab: (id) => {
        if (FIXED_TAB_IDS.includes(id)) return

        set((state) => {
          const tabs = state.tabs.filter((tab) => tab.id !== id)
          const activeTabId = state.activeTabId === id ? 'foryou' : state.activeTabId
          return { tabs, activeTabId }
        })
      },

      setActiveTab: (id) => set({ activeTabId: id }),

      hasTab: (id) => get().tabs.some((tab) => tab.id === id),
      hasNetworkTab: (chainId) => get().tabs.some((tab) => tab.type === 'network' && tab.chainId === chainId),
    }),
    {
      name: 'hup-home-tabs-state',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ tabs: state.tabs, activeTabId: state.activeTabId }),
      // v1 drops the retired search/notifications/profile tab types that
      // earlier sessions may have persisted. v2 pins For you and Following first.
      version: 2,
      migrate: (persisted) => {
        const added = (persisted?.tabs ?? []).filter(
          (tab) => (tab.type === 'network' || TAB_TYPE_SCHEMA[tab.type]) && !FIXED_TAB_IDS.includes(tab.id),
        )
        const tabs = [...DEFAULT_TABS, ...added]
        const activeTabId = tabs.some((tab) => tab.id === persisted?.activeTabId) ? persisted.activeTabId : 'foryou'
        return { ...persisted, tabs, activeTabId }
      },
    },
  ),
)

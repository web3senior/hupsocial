'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { BellIcon, BroadcastIcon, FlameIcon, HouseIcon, MagnifyingGlassIcon, UserCheckIcon, UserIcon } from '@phosphor-icons/react'
import { config } from '@/config/wagmi'

// Static schema for non-network tab types. Icons/labels stay out of localStorage
// (same reasoning as NAV_ITEMS_SCHEMA in useSidebarStore.js) to avoid serialization issues.
export const TAB_TYPE_SCHEMA = {
  foryou: { label: 'For you', icon: HouseIcon },
  following: { label: 'Following', icon: UserCheckIcon },
  trending: { label: 'Trending', icon: FlameIcon },
  status: { label: 'Status posts', icon: BroadcastIcon },
  search: { label: 'Search', icon: MagnifyingGlassIcon },
  notifications: { label: 'Notifications', icon: BellIcon },
  profile: { label: 'Profile', icon: UserIcon },
}

const DEFAULT_TABS = [{ id: 'foryou', type: 'foryou' }]

const networkTabId = (chainId) => `net-${chainId}`

// Plain function (not a store getter) so components can memoize the result.
// Calling this inside a zustand selector would return a fresh array every
// snapshot and trigger React's "maximum update depth exceeded" loop.
export const resolveTabs = (tabs) =>
  tabs.map((tab) => {
    if (tab.type === 'network') {
      const chain = config.chains.find((c) => c.id === tab.chainId)
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
        if (id === 'foryou') return

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
    },
  ),
)

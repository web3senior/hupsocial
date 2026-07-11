'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import {
  BellIcon,
  BookmarkSimpleIcon,
  BriefcaseIcon,
  CalendarBlankIcon,
  ChartBarIcon,
  ChatCircleIcon,
  CoinsIcon,
  HeartIcon,
  HouseIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  SquaresFourIcon,
  TagIcon,
  TrophyIcon,
  UsersIcon,
} from '@phosphor-icons/react'

// Static navigation schema with icons.
// Keeps components out of localStorage to prevent serialization crashes.
export const NAV_ITEMS_SCHEMA = [
  { id: 'foryou', name: 'For you', path: '/', icon: HouseIcon },
  { id: 'new-post', name: 'New post', component: 'new-post', icon: PlusIcon },
  { id: 'search', name: 'Search', path: '/search', icon: MagnifyingGlassIcon },
  { id: 'divider-primary', type: 'divider' },
  { id: 'communities', name: 'Communities', path: '/communities', icon: UsersIcon },
  { id: 'leaderboard', name: 'Leaderboard', path: '/leaderboard', icon: TrophyIcon },
  { id: 'bazzar', name: 'Bazzar', path: '/bazzar', icon: TagIcon },
  { id: 'events', name: 'Events', path: '/events', icon: CalendarBlankIcon },
  { id: 'jobs', name: 'Jobs', path: '/jobs', icon: BriefcaseIcon },
  { id: 'apps', name: 'Apps', path: '/apps', icon: SquaresFourIcon },
  { id: 'divider-secondary', type: 'divider' },
  { id: 'chat', name: 'Chat', path: '/chat', icon: ChatCircleIcon },
  { id: 'notifications', name: 'Notifications', path: '/notifications', icon: BellIcon, hasBadge: true },
  { id: 'batch-like', name: 'Like', path: '/batch-like', icon: HeartIcon, hasBadge: true },
  { id: 'saved', name: 'Saved', path: '/saved', icon: BookmarkSimpleIcon },
  { id: 'insights', name: 'Insights', path: '/insights', icon: ChartBarIcon },
  { id: 'revenue', name: 'Revenue', path: '/revenue', icon: CoinsIcon },
]

export const useSidebarStore = create(
  persist(
    (set, get) => ({
      // State configurations
      isMenuOpen: false,
      isMobileMenuOpen: false,
      isComponentOpen: false,

      // Dictionary mapping network ids to array of post ids
      likedPostIds: {},

      // Actions for Batch Like queue management split by network id
      addToBatch: (networkId, postId) =>
        set((state) => {
          const currentNetworkQueue = state.likedPostIds?.[networkId] ?? []

          // Prevent duplicate queuing inside the specific network sub-array
          if (currentNetworkQueue.includes(postId)) return state

          return {
            likedPostIds: {
              ...state.likedPostIds,
              [networkId]: [...currentNetworkQueue, postId],
            },
          }
        }),

      removeFromBatch: (networkId, postId) =>
        set((state) => {
          const currentNetworkQueue = state.likedPostIds?.[networkId] ?? []

          return {
            likedPostIds: {
              ...state.likedPostIds,
              [networkId]: currentNetworkQueue.filter((id) => id !== postId),
            },
          }
        }),

      // Clear the queue for a single chain or clear everything entirely if no parameter provided
      clearBatch: (networkId) =>
        set((state) => {
          if (networkId !== undefined) {
            return {
              likedPostIds: {
                ...state.likedPostIds,
                [networkId]: [],
              },
            }
          }
          return { likedPostIds: {} }
        }),

      // UI Actions
      setIsComponentOpen: () => set((state) => ({ isComponentOpen: !state.isComponentOpen })),
      openComponent: () => set({ isComponentOpen: true }),

      openMenu: () => set({ isMenuOpen: true }),
      closeMenu: () => set({ isMenuOpen: false }),
      toggleMenu: () => set((state) => ({ isMenuOpen: !state.isMenuOpen })),

      openMobileMenu: () => set({ isMobileMenuOpen: true }),
      closeMobileMenu: () => set({ isMobileMenuOpen: false }),
      toggleMobileMenu: () => set((state) => ({ isMobileMenuOpen: !state.isMobileMenuOpen })),

      // Computed layout helper that appends dynamic badges natively
      getNavItems: () => {
        const likedState = get().likedPostIds ?? {}

        // Calculate the aggregate total length across all networks safely
        let queueCount = 0
        if (Array.isArray(likedState)) {
          // Backward compatibility fallback handler for legacy local storage records
          queueCount = likedState.length
        } else {
          queueCount = Object.values(likedState).reduce((acc, currentArray) => {
            return acc + (Array.isArray(currentArray) ? currentArray.length : 0)
          }, 0)
        }

        return NAV_ITEMS_SCHEMA.map((item) => {
          if (item.id === 'batch-like') {
            return { ...item, badgeCount: queueCount }
          }
          return item
        })
      },
    }),
    {
      name: 'hup-sidebar-state',
      storage: createJSONStorage(() => localStorage),
      // Only persist specific variables to localStorage to keep things fast
      partialize: (state) => ({
        isMenuOpen: state.isMenuOpen,
        likedPostIds: state.likedPostIds,
        isComponentOpen: state.isComponentOpen,
      }),
    }
  )
)

'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import {
  ArrowsDownUpIcon,
  BellIcon,
  BookmarkSimpleIcon,
  BriefcaseIcon,
  CalendarBlankIcon,
  ChartBarIcon,
  ChatCircleIcon,
  CoinsIcon,
  HouseIcon,
  ListChecksIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  PlayCircleIcon,
  PulseIcon,
  SquaresFourIcon,
  StorefrontIcon,
  TrophyIcon,
  UsersIcon,
} from '@phosphor-icons/react'
import { SECTIONS, sectionLanding, sectionPaths } from '@/config/sections'
import { POLLS_ENABLED } from '@/config/features'

// Static navigation schema with icons.
// Keeps components out of localStorage to prevent serialization crashes.
//
// Grouped by what the user came to do, not by which contract backs the page: a row
// with `activePaths` is a section (config/sections.js) whose member routes are
// reached through the tab strip on its pages, and it stays highlighted on all of them.
export const NAV_ITEMS_SCHEMA = [
  { id: 'foryou', name: 'For you', path: '/', icon: HouseIcon },
  { id: 'shorts', name: 'Shorts', path: '/shorts', icon: PlayCircleIcon },
  { id: 'new-post', name: 'New post', component: 'new-post', icon: PlusIcon },
  { id: 'search', name: 'Search', path: '/search', icon: MagnifyingGlassIcon },
  { id: 'notifications', name: 'Notifications', path: '/notifications', icon: BellIcon, hasBadge: true },
  { id: 'divider-primary', type: 'divider' },
  { id: 'communities', name: 'Communities', path: '/communities', icon: UsersIcon },
  { id: 'leaderboard', name: 'Leaderboard', path: '/leaderboard', icon: TrophyIcon },
  // Sits with the social rows rather than the market ones: a poll costs nothing and asks for
  // an opinion. A checklist, not a bar chart — Insights owns ChartBar here, and the sideways
  // variant just reads as a chart someone knocked over.
  ...(POLLS_ENABLED ? [{ id: 'polls', name: 'Polls', path: '/polls', icon: ListChecksIcon }] : []),
  { id: 'bazaar', name: 'Bazaar', path: sectionLanding(SECTIONS.bazaar), icon: StorefrontIcon, activePaths: sectionPaths(SECTIONS.bazaar) },
  { id: 'trade', name: 'Trade', path: sectionLanding(SECTIONS.trade), icon: ArrowsDownUpIcon, activePaths: sectionPaths(SECTIONS.trade) },
  { id: 'events', name: 'Events', path: '/events', icon: CalendarBlankIcon },
  { id: 'jobs', name: 'Jobs', path: '/jobs', icon: BriefcaseIcon },
  { id: 'apps', name: 'Apps', path: '/apps', icon: SquaresFourIcon },
  { id: 'divider-secondary', type: 'divider' },
  { id: 'chat', name: 'Chat', path: '/chat', icon: ChatCircleIcon },
  { id: 'saved', name: 'Saved', path: '/saved', icon: BookmarkSimpleIcon },
  // Reads with Insights as a pair: what the network did, then what you did.
  { id: 'activity', name: 'Activity', path: '/activity', icon: PulseIcon },
  { id: 'insights', name: 'Insights', path: '/insights', icon: ChartBarIcon },
  // Your own sales, so it sits with the rest of your account rather than in the market block
  { id: 'revenue', name: 'Revenue', path: '/revenue', icon: CoinsIcon },
]

// Normalize a wallet address into a stable storage bucket key
export const walletBucketKey = (address) => (typeof address === 'string' && address !== '' ? address.toLowerCase() : '__guest')

// Optimistic like overrides outlive the cidex indexing lag; entries older than
// this are ignored so the server state becomes authoritative again
export const LIKE_OVERRIDE_TTL_MS = 5 * 60 * 1000

// Resolve a still-fresh optimistic override for one post, or null
export const getLikeOverride = (likeOverrides, address, networkId, postId) => {
  const entry = likeOverrides?.[walletBucketKey(address)]?.[networkId]?.[postId]
  if (!entry) return null
  return Date.now() - entry.at < LIKE_OVERRIDE_TTL_MS ? entry : null
}

export const useSidebarStore = create(
  persist(
    (set) => ({
      // State configurations
      isMenuOpen: true,
      isMobileMenuOpen: false,
      isComponentOpen: false,

      // Optimistic like state written the moment a like/unlike tx lands,
      // consumed by Like cards until the indexer confirms (wallet → network → post)
      likeOverrides: {},

      markLikeOverride: (wallet, networkId, postIds, liked) =>
        set((state) => {
          const walletKey = walletBucketKey(wallet)
          const now = Date.now()
          const walletMap = state.likeOverrides?.[walletKey] ?? {}
          const networkMap = {}

          // Re-copy only entries still inside the TTL so the persisted map stays small
          for (const [id, entry] of Object.entries(walletMap[networkId] ?? {})) {
            if (entry && now - entry.at < LIKE_OVERRIDE_TTL_MS) networkMap[id] = entry
          }

          for (const id of Array.isArray(postIds) ? postIds : [postIds]) {
            networkMap[id] = { liked, at: now }
          }

          return {
            likeOverrides: {
              ...state.likeOverrides,
              [walletKey]: { ...walletMap, [networkId]: networkMap },
            },
          }
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

      // Badges resolve in Aside.jsx from the schema's own badge/hasBadge keys, so nothing
      // per-item lives in the store
      getNavItems: () => NAV_ITEMS_SCHEMA,
    }),
    {
      name: 'hup-sidebar-state',
      storage: createJSONStorage(() => localStorage),
      version: 3,
      migrate: (persistedState, version) => {
        const migrated = { ...persistedState }

        // v1: one-time reset so browsers holding the old collapsed default open expanded
        if (version < 1) {
          migrated.isMenuOpen = true
        }

        // v3: the batch-like basket is gone — every heart sends on tap — so a queue left
        // over from v1/v2 is dropped rather than carried around forever
        if (version < 3) {
          delete migrated.likedPostIds
        }

        return migrated
      },
      // Only persist specific variables to localStorage to keep things fast
      partialize: (state) => ({
        isMenuOpen: state.isMenuOpen,
        likeOverrides: state.likeOverrides,
        isComponentOpen: state.isComponentOpen,
      }),
    }
  )
)

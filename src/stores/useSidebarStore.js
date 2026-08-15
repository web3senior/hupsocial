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
  ChartLineUpIcon,
  ChatCircleIcon,
  CoinIcon,
  CoinsIcon,
  HandshakeIcon,
  HouseIcon,
  Image,
  MagnifyingGlassIcon,
  PlusIcon,
  SquaresFourIcon,
  StorefrontIcon,
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
  { id: 'notifications', name: 'Notifications', path: '/notifications', icon: BellIcon, hasBadge: true },
  { id: 'divider-primary', type: 'divider' },
  { id: 'communities', name: 'Communities', path: '/communities', icon: UsersIcon },
  { id: 'leaderboard', name: 'Leaderboard', path: '/leaderboard', icon: TrophyIcon },
  { id: 'bazaar', name: 'Bazaar', path: '/bazaar', icon: TagIcon },
  { id: 'nfts', name: 'NFTs', path: '/nfts', icon: StorefrontIcon },
  { id: 'drops', name: 'Drops', path: '/drops', icon: Image },
  { id: 'predict', name: 'Predict', path: '/predict', icon: ChartLineUpIcon },
  { id: 'tokens', name: 'Tokens', path: '/launches', icon: CoinIcon },
  { id: 'swap', name: 'Swap', path: '/swap', icon: ArrowsDownUpIcon },
  { id: 'p2p', name: 'P2P', path: '/p2p', icon: HandshakeIcon },
  { id: 'revenue', name: 'Revenue', path: '/revenue', icon: CoinsIcon },
  { id: 'events', name: 'Events', path: '/events', icon: CalendarBlankIcon },
  { id: 'jobs', name: 'Jobs', path: '/jobs', icon: BriefcaseIcon },
  { id: 'apps', name: 'Apps', path: '/apps', icon: SquaresFourIcon },
  { id: 'divider-secondary', type: 'divider' },
  { id: 'chat', name: 'Chat', path: '/chat', icon: ChatCircleIcon },
  { id: 'saved', name: 'Saved', path: '/saved', icon: BookmarkSimpleIcon },
  { id: 'insights', name: 'Insights', path: '/insights', icon: ChartBarIcon },
]

// Baskets migrated from the pre-wallet era live under this key until the
// next wallet that connects claims them via claimLegacyBatch
const LEGACY_BATCH_KEY = '__legacy'

// Normalize a wallet address into a stable storage bucket key
export const walletBatchKey = (address) => (typeof address === 'string' && address !== '' ? address.toLowerCase() : '__guest')

// Resolve the per-network queue map that belongs to one wallet
export const getWalletBatchMap = (likedPostIds, address) => {
  const buckets = likedPostIds ?? {}
  if (Array.isArray(buckets)) return {}

  const bucket = buckets[walletBatchKey(address)]
  return bucket && !Array.isArray(bucket) ? bucket : {}
}

// Aggregate the total queued items across every network in one wallet bucket
export const countBatchItems = (networkMap) => {
  return Object.values(networkMap ?? {}).reduce((acc, currentArray) => {
    return acc + (Array.isArray(currentArray) ? currentArray.length : 0)
  }, 0)
}

// Optimistic like overrides outlive the cidex indexing lag; entries older than
// this are ignored so the server state becomes authoritative again
export const LIKE_OVERRIDE_TTL_MS = 5 * 60 * 1000

// Resolve a still-fresh optimistic override for one post, or null
export const getLikeOverride = (likeOverrides, address, networkId, postId) => {
  const entry = likeOverrides?.[walletBatchKey(address)]?.[networkId]?.[postId]
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

      // Dictionary mapping wallet address keys to network-id keyed post id arrays
      likedPostIds: {},

      // Optimistic like state written the moment a like/unlike tx lands,
      // consumed by Like cards until the indexer confirms (wallet → network → post)
      likeOverrides: {},

      markLikeOverride: (wallet, networkId, postIds, liked) =>
        set((state) => {
          const walletKey = walletBatchKey(wallet)
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

      // Actions for Batch Like queue management split by wallet then network id
      addToBatch: (wallet, networkId, postId) =>
        set((state) => {
          const walletKey = walletBatchKey(wallet)
          const walletQueues = getWalletBatchMap(state.likedPostIds, wallet)
          const currentNetworkQueue = walletQueues[networkId] ?? []

          // Prevent duplicate queuing inside the specific network sub-array
          if (currentNetworkQueue.includes(postId)) return state

          return {
            likedPostIds: {
              ...state.likedPostIds,
              [walletKey]: {
                ...walletQueues,
                [networkId]: [...currentNetworkQueue, postId],
              },
            },
          }
        }),

      removeFromBatch: (wallet, networkId, postId) =>
        set((state) => {
          const walletKey = walletBatchKey(wallet)
          const walletQueues = getWalletBatchMap(state.likedPostIds, wallet)
          const currentNetworkQueue = walletQueues[networkId] ?? []

          return {
            likedPostIds: {
              ...state.likedPostIds,
              [walletKey]: {
                ...walletQueues,
                [networkId]: currentNetworkQueue.filter((id) => id !== postId),
              },
            },
          }
        }),

      // Clear one chain queue for the wallet, or the wallet's whole basket if no network given
      clearBatch: (wallet, networkId) =>
        set((state) => {
          const walletKey = walletBatchKey(wallet)

          if (networkId !== undefined) {
            return {
              likedPostIds: {
                ...state.likedPostIds,
                [walletKey]: {
                  ...getWalletBatchMap(state.likedPostIds, wallet),
                  [networkId]: [],
                },
              },
            }
          }

          return {
            likedPostIds: {
              ...state.likedPostIds,
              [walletKey]: {},
            },
          }
        }),

      // Hand the pre-wallet legacy basket to the first wallet that connects
      claimLegacyBatch: (wallet) =>
        set((state) => {
          const legacyQueues = state.likedPostIds?.[LEGACY_BATCH_KEY]
          if (!wallet || !legacyQueues || Array.isArray(legacyQueues)) return state

          const walletKey = walletBatchKey(wallet)
          const mergedQueues = { ...getWalletBatchMap(state.likedPostIds, wallet) }

          for (const [networkId, legacyIds] of Object.entries(legacyQueues)) {
            if (!Array.isArray(legacyIds)) continue
            const existingIds = mergedQueues[networkId] ?? []
            mergedQueues[networkId] = [...existingIds, ...legacyIds.filter((id) => !existingIds.includes(id))]
          }

          const { [LEGACY_BATCH_KEY]: _claimed, ...remainingBuckets } = state.likedPostIds

          return {
            likedPostIds: {
              ...remainingBuckets,
              [walletKey]: mergedQueues,
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

      // The basket lives in the floating heart (components/BatchLikeTrigger) rather than a
      // nav row, so the schema needs no per-item badge wiring
      getNavItems: () => NAV_ITEMS_SCHEMA,
    }),
    {
      name: 'hup-sidebar-state',
      storage: createJSONStorage(() => localStorage),
      version: 2,
      migrate: (persistedState, version) => {
        const migrated = { ...persistedState }

        // v1: one-time reset so browsers holding the old collapsed default open expanded
        if (version < 1) {
          migrated.isMenuOpen = true
        }

        // v2: baskets became wallet-keyed; park the old network-keyed map under the
        // legacy bucket so the next connecting wallet can claim it
        if (version < 2) {
          const legacyMap = migrated.likedPostIds
          const hasLegacyEntries =
            legacyMap && typeof legacyMap === 'object' && !Array.isArray(legacyMap) && Object.keys(legacyMap).length > 0

          migrated.likedPostIds = hasLegacyEntries ? { [LEGACY_BATCH_KEY]: legacyMap } : {}
        }

        return migrated
      },
      // Only persist specific variables to localStorage to keep things fast
      partialize: (state) => ({
        isMenuOpen: state.isMenuOpen,
        likedPostIds: state.likedPostIds,
        likeOverrides: state.likeOverrides,
        isComponentOpen: state.isComponentOpen,
      }),
    }
  )
)

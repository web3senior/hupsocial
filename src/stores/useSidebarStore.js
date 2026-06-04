'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { Bookmark, Briefcase, Calendar, MessageCircle, Heart, House, LayoutGrid, Plus, Search, Trophy, Users } from 'lucide-react'

const DEFAULT_NAV_ITEMS = [
  { id: 'onchain', name: 'Onchain', path: '/', icon: House },
  { id: 'new-post', name: 'New post', component: 'new-post', icon: Plus },
  { id: 'search', name: 'Search', path: '/search', icon: Search },
  { id: 'divider-primary', type: 'divider' },
  { id: 'communities', name: 'Communities', path: '/communities', icon: Users },
  { id: 'leaderboard', name: 'Leaderboard', path: '/leaderboard', icon: Trophy },
  { id: 'events', name: 'Events', path: '/events', icon: Calendar },
  { id: 'jobs', name: 'Jobs', path: '/jobs', icon: Briefcase },
  { id: 'apps', name: 'Apps', path: '/apps', icon: LayoutGrid },
  { id: 'divider-secondary', type: 'divider' },
  { id: 'chat', name: 'Chat', path: '/chat', icon: MessageCircle },
  { id: 'activity', name: 'Activity', path: '/activity', icon: Heart },
  { id: 'saved', name: 'Saved', path: '/saved', icon: Bookmark },
]

export const useSidebarStore = create(
  persist(
    (set) => ({
      navItems: DEFAULT_NAV_ITEMS,

      isMenuOpen: false,
      isMobileMenuOpen: false,

      setNavItems: (navItems) => set({ navItems }),

      openMenu: () => set({ isMenuOpen: true }),
      closeMenu: () => set({ isMenuOpen: false }),
      toggleMenu: () => set((state) => ({ isMenuOpen: !state.isMenuOpen })),

      openMobileMenu: () => set({ isMobileMenuOpen: true }),
      closeMobileMenu: () => set({ isMobileMenuOpen: false }),
      toggleMobileMenu: () =>
        set((state) => ({
          isMobileMenuOpen: !state.isMobileMenuOpen,
        })),
    }),
    {
      name: 'sidebar-menu',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        isMenuOpen: state.isMenuOpen,
      }),
    },
  ),
)

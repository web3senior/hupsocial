import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import {
  House,
  Plus,
  Search,
  Users,
  Trophy,
  Calendar,
  Briefcase,
  LayoutGrid,
  Heart,
  Bookmark,
} from 'lucide-react'

export const useSidebarStore = create(
  persist(
    (set) => ({
      navItems: [
        { name: 'Onchain', path: '/', icon: House },
        { name: 'New post', path: '/new', icon: Plus },
        { name: 'Search', path: '/search', icon: Search },
        { name: 'br' },
        { name: 'Communities', path: '/community', icon: Users },
        { name: 'Leaderboard', path: '/leaderboard', icon: Trophy },
        { name: 'Events', path: '/events', icon: Calendar },
        { name: 'Jobs', path: '/jobs', icon: Briefcase },
        { name: 'Apps', path: '/apps', icon: LayoutGrid },
        { name: 'br' },
        { name: 'Activity', path: '/activity', icon: Heart },
        { name: 'Saved', path: '/saved', icon: Bookmark },
      ],

      isMenuOpen: false,
      isMobileMenuOpen: false,

      setNavItems: (navItems) => set({ navItems }),

      openMenu: () => set({ isMenuOpen: true }),
      closeMenu: () => set({ isMenuOpen: false }),
      toggleMenu: () =>
        set((state) => ({
          isMenuOpen: !state.isMenuOpen,
        })),

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

      // only save desktop expanded/collapsed state
      partialize: (state) => ({
        isMenuOpen: state.isMenuOpen,
      }),
    }
  )
)
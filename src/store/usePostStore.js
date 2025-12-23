import { create } from 'zustand'

export const usePostStore = create((set, get) => ({
  posts: { list: [] },
  postsLoaded: 0,
  totalPosts: 0,
  apps: { list: [] },
  TABS_DATA: [],
  hasInitialized: false, // Key flag to prevent re-fetching

  setInitialData: (total, apps, initialPosts) =>
    set({
      totalPosts: total,
      TABS_DATA: [
        { id: 'feed', label: 'Feed', count: total || 0 },
        { id: 'polls', label: 'Polls' },
        { id: 'events', label: 'Events' },
        { id: 'jobs', label: 'Jobs' },
        { id: 'apps', label: 'Apps' },
      ],
      apps: { list: apps },
      posts: { list: initialPosts },
      postsLoaded: initialPosts.length,
      hasInitialized: true,
    }),

  appendPosts: (newPosts) =>
    set((state) => ({
      posts: { list: [...state.posts.list, ...newPosts] },
      postsLoaded: state.postsLoaded + newPosts.length,
    })),
}))

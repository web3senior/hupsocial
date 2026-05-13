import { create } from 'zustand'

export const usePostStore = create((set, get) => ({
  posts: { list: [] },
  postsLoaded: 0,
  hasMore: false,
  totalPosts: 0,
  apps: { list: [] },
  TABS_DATA: [],
  hasInitialized: false,

  setInitialData: (apps, postsResponse) => {
    const initialPosts = postsResponse?.data || []
    set({
      totalPosts: postsResponse?.meta?.total || initialPosts.length,
      TABS_DATA: [
        { id: 'posts', label: 'Posts' },
        { id: 'communities', label: 'Communities' },
        { id: 'events', label: 'Events' },
        { id: 'jobs', label: 'Jobs' },
        { id: 'apps', label: 'Apps' },
      ],
      apps: { list: apps },
      posts: { list: initialPosts },
      postsLoaded: initialPosts.length,
      hasMore: postsResponse?.meta?.hasMore || false,
      hasInitialized: true,
    })
  },

  appendPosts: (postsResponse) =>
    set((state) => {
      const newPosts = postsResponse?.data || []
      const existingIds = new Set(state.posts.list.map((p) => p.id))
      const uniqueNewPosts = newPosts.filter((p) => !existingIds.has(p.id))

      return {
        posts: { list: [...state.posts.list, ...uniqueNewPosts] },
        postsLoaded: state.postsLoaded + uniqueNewPosts.length,
        hasMore: postsResponse?.meta?.hasMore || false,
      }
    }),
}))
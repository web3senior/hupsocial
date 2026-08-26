import { create } from 'zustand'

export const usePostStore = create((set, get) => ({
  posts: { list: [] },
  postsLoaded: 0,
  hasMore: false,
  totalPosts: 0,
  apps: { list: [] },
  TABS_DATA: [],
  hasInitialized: false,
  currentPost: null,

  // Bumped by the Aside home link when the page is already scrolled to top;
  // the active feed tab watches this and re-fetches page 1.
  feedRefreshNonce: 0,
  requestFeedRefresh: () => set((state) => ({ feedRefreshNonce: state.feedRefreshNonce + 1 })),

  // Bumped by lib/postPublication.js once the indexer has the viewer's own new post. Separate
  // from feedRefreshNonce because that one is an explicit "take me to the top" request, while
  // this one arrives seconds after the fact and must not yank a reader out of the feed.
  authoredPostNonce: 0,
  notifyAuthoredPost: () => set((state) => ({ authoredPostNonce: state.authoredPostNonce + 1 })),

  setCurrentPost: (post) => set({ currentPost: post }),

  setInitialData: (apps, postsResponse) => {
    const rawPosts = postsResponse?.data || []
    const seenIds = new Set()
    const initialPosts = rawPosts.filter((p) => {
      if (seenIds.has(p.id)) return false
      seenIds.add(p.id)
      return true
    })
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
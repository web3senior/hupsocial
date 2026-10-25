import { create } from 'zustand'
import { usePostStore } from './usePostStore'

/**
 * Opening a post in place, X-style: the feed stays mounted (hidden) and the post renders over
 * its slot in <main>, with the URL moved by history.pushState so no server roundtrip happens.
 * Next 16 syncs usePathname with pushState, which is what PostOverlayHost keys off: the overlay
 * shows while the pathname is this entry's path, so back, forward and any real navigation away
 * open and close it with no extra bookkeeping. A refresh or a shared link still lands on the real
 * route (app/networks/[networkId]/[postId]/page.jsx).
 *
 * The entry is kept after the overlay closes on purpose: forward, or back from a page the
 * overlay navigated to, returns to the same path and must find the post still here.
 */
export const usePostOverlayStore = create((set) => ({
  // { path, fromPath, networkId, postId, post, scrollY } | null
  entry: null,

  open: (item) => {
    const networkId = String(item.network_id)
    const postId = String(item.id)
    const path = `/networks/${networkId}/${postId}`

    // PostDetails paints from the same cached row the route version reads
    usePostStore.getState().setCurrentPost(item)
    set({
      entry: { path, fromPath: window.location.pathname, networkId, postId, post: item, scrollY: window.scrollY },
    })
    window.history.pushState(null, '', path)
  },
}))

/** Whether a PostOverlayHost is mounted to show it; set by the host itself. */
let hostMounted = false
export const setPostOverlayHostMounted = (value) => {
  hostMounted = value
}

/**
 * Opens a post in place when the shell can show it, else falls back to a real navigation.
 * @param {Object} item Post row with id and network_id.
 * @param {{ push: Function }} router Next's router, for the fallback.
 */
export function openPost(item, router) {
  if (hostMounted && typeof window !== 'undefined') {
    usePostOverlayStore.getState().open(item)
    return
  }
  usePostStore.getState().setCurrentPost(item)
  router.push(`/networks/${item.network_id}/${item.id}`)
}

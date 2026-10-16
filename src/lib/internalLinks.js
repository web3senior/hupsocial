import { internalPathOf } from '@/lib/markdown'

/**
 * Route a plain click on an internal <a> through the client router instead of a full page load.
 * Modified clicks, new-tab targets, downloads and same-page anchors keep the browser's behavior.
 * @param {MouseEvent|import('react').MouseEvent} event
 * @param {{ push: (href: string) => void }} router
 * @returns {boolean} Whether the click was routed.
 */
export function routeInternalLinkClick(event, router) {
  if (event.defaultPrevented || event.button !== 0) return false
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false

  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
  if (!anchor || anchor.hasAttribute('download')) return false

  const target = anchor.getAttribute('target')
  if (target && target !== '_self') return false

  const path = internalPathOf(anchor.getAttribute('href'))
  if (!path) return false

  // A hash jump on the current page is the browser's job: it scrolls without a navigation
  const { pathname, search } = window.location
  const [withoutHash] = path.split('#')
  if (path.includes('#') && withoutHash === `${pathname}${search}`) return false

  event.preventDefault()
  router.push(path)
  return true
}

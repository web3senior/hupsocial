'use client'

import { useEffect, useState } from 'react'

// Raised by a back/forward traversal, consumed by the route change it causes.
let traversed = false

// Module-level rather than per instance: the header's back arrow is always mounted, but a page
// can mount its own (the post page's title row) after the route changed. Each route is judged
// once and every instance reads that verdict, so a late mount still knows where it came from
// and two instances never race to consume `traversed`.
let lastPathname = null
let verdict = { pathname: null, canGoBack: false }

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    traversed = true
  })
}

/**
 * Whether one step back in history stays inside the app, so a back button can return the reader
 * to the page they came from instead of a fixed link. False on the first page of a visit (a
 * shared URL), where stepping back would leave the site.
 *
 * The Navigation API answers exactly: its entries are this origin's only. Without it, a route
 * reached by an in-app push is known to have the app behind it; one reached by a traversal is
 * not, and reports false.
 *
 * @param {string} pathname The current route, from usePathname().
 */
export function useCanGoBack(pathname) {
  const [canGoBack, setCanGoBack] = useState(false)

  useEffect(() => {
    if (verdict.pathname !== pathname) {
      const arrivedByPush = lastPathname !== null && lastPathname !== pathname && !traversed
      lastPathname = pathname
      traversed = false

      const index = window.navigation?.currentEntry?.index
      verdict = { pathname, canGoBack: typeof index === 'number' ? index > 0 : arrivedByPush }
    }
    setCanGoBack(verdict.canGoBack)
  }, [pathname])

  return canGoBack
}

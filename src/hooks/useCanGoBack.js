'use client'

import { useEffect, useRef, useState } from 'react'

// Raised by a back/forward traversal, consumed by the route change it causes.
let traversed = false

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
  const lastPathnameRef = useRef(null)

  useEffect(() => {
    const arrivedByPush = lastPathnameRef.current !== null && lastPathnameRef.current !== pathname && !traversed
    lastPathnameRef.current = pathname
    traversed = false

    const index = window.navigation?.currentEntry?.index
    setCanGoBack(typeof index === 'number' ? index > 0 : arrivedByPush)
  }, [pathname])

  return canGoBack
}

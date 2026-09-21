'use client'

import { preload } from 'react-dom'

/**
 * Preload hints for JSON the page fetches right after hydration. A client component on purpose:
 * a server-side preload() after an await lands only in the RSC payload, never the HTML. Server
 * render only — on a client navigation the thread is already cached or in flight. Anonymous CORS
 * is what a default same-origin fetch() matches, so the browser hands it the response.
 * @param {Object} props
 * @param {string[]} props.hrefs Same-origin URLs, byte-for-byte the ones the client fetches.
 */
export default function PreloadFetch({ hrefs }) {
  if (typeof window === 'undefined') {
    for (const href of hrefs) preload(href, { as: 'fetch', crossOrigin: 'anonymous' })
  }
  return null
}

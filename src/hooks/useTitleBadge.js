'use client'

import { useEffect } from 'react'

// Matches the prefix this hook writes, so a re-applied badge never stacks on a stale one
const BADGE_PREFIX_RE = /^\(\d+\+?\)\s/

const stripBadge = (title) => title.replace(BADGE_PREFIX_RE, '')

/**
 * Prefix the browser-tab title with the unread count, X-style: "(2) Hup | Home".
 * Next metadata and PageTitle both rewrite <title> on navigation, so the prefix is
 * re-applied from a head MutationObserver rather than written once.
 * @param {number} count
 */
export const useTitleBadge = (count) => {
  const total = Number(count) || 0

  useEffect(() => {
    // Inert at zero: the previous count's cleanup already restored the bare title
    if (total < 1 || typeof document === 'undefined') return

    const label = total > 99 ? '99+' : String(total)
    let applied = null

    const apply = () => {
      const current = document.title
      if (current === applied) return

      const next = `(${label}) ${stripBadge(current)}`

      applied = next
      if (next !== current) document.title = next
    }

    apply()

    const observer = new MutationObserver(apply)
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })

    return () => {
      observer.disconnect()
      document.title = stripBadge(document.title)
    }
  }, [total])
}

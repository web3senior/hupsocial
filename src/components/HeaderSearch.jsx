'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MagnifyingGlassIcon } from '@phosphor-icons/react'
import styles from './HeaderSearch.module.scss'

/**
 * Takes over the header's centre slot on "/", where the feed labels itself with the
 * tab strip and so sets no page title. It is only the entry point: submitting hands
 * off to /search, which already owns the debounced query and the results list.
 */
export default function HeaderSearch() {
  const router = useRouter()
  const [query, setQuery] = useState('')

  // Focus is the earliest reliable signal that a search is coming; by the time the
  // term is typed the route is warm.
  const handleFocus = useCallback(() => router.prefetch('/search'), [router])

  const handleSubmit = (event) => {
    event.preventDefault()

    const term = query.trim()
    router.push(term ? `/search?q=${encodeURIComponent(term)}` : '/search')
  }

  return (
    <form role="search" className={styles.search} onSubmit={handleSubmit}>
      <button type="submit" className={styles['search__submit']} aria-label="Search">
        <MagnifyingGlassIcon size={18} aria-hidden="true" />
      </button>

      <input
        type="search"
        className={styles['search__input']}
        placeholder="Search"
        aria-label="Search posts"
        enterKeyHint="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={handleFocus}
      />
    </form>
  )
}

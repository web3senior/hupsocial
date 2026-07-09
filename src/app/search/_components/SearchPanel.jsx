'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { MagnifyingGlassIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import Post from '@/components/Post'
import styles from '../page.module.scss'

/**
 * Search box + results, extracted from search/page.jsx so it can also be
 * rendered inline as a home tab (see HomeTabStrip.jsx / page.jsx).
 */
export default function SearchPanel() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [results, setResults] = useState([])
  const [isLoading, setIsLoading] = useState(false)

  const handlePostPrefetch = (networkId, id) => {
    router.prefetch(`/networks/${networkId}/${id}`)
  }

  const handlePostClick = (networkId, id) => {
    router.push(`/networks/${networkId}/${id}`)
  }

  useEffect(() => {
    if (query.trim().length < 2) return setResults([])

    const fetchData = async () => {
      setIsLoading(true)
      const res = await fetch(`/api/v1/search?q=${encodeURIComponent(query)}`)
      const json = await res.json()
      if (json.success) setResults(json.data)
      setIsLoading(false)
    }

    const timer = setTimeout(fetchData, 400)
    return () => clearTimeout(timer)
  }, [query])

  return (
    <div className={`__container ${styles.page__container}`} data-width="small">
      <label className={clsx(styles.search, 'rounded-full')}>
        <MagnifyingGlassIcon size={18} aria-hidden="true" />
        <input
          type="search"
          className={styles.search__input}
          placeholder="Search the multichain..."
          aria-label="Search posts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      <div className={styles.results}>
        {results.map((item, i) => (
          <section
            key={item.id}
            className={`${styles.postWrapper} animate fade`}
            onClick={() => handlePostClick(item.network_id, item.id)}
            onMouseEnter={() => handlePostPrefetch(item.network_id, item.id)}
            onTouchStart={() => handlePostPrefetch(item.network_id, item.id)}
          >
            <Post item={item} networkName={item.network_name} actions={['like', 'comment', 'share', 'repost', 'bookmark']} />
            {i < results.length - 1 && <hr className={styles.divider} />}
          </section>
        ))}

        {!isLoading && query.length > 2 && results.length === 0 && (
          <p className={styles.emptyState}>No posts found matching "{query}"</p>
        )}
      </div>
    </div>
  )
}

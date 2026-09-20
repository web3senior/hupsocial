'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import SearchBox from './SearchBox'
import styles from './HeaderSearch.module.scss'

/**
 * Takes over the header's centre slot on "/", where the feed labels itself with the
 * tab strip and so sets no page title. The box itself is the shared SearchBox, so people
 * suggest as you type right here; a submit hands the query to /search, which owns the
 * post results.
 */
export default function HeaderSearch() {
  const router = useRouter()

  const handleSubmit = useCallback((query) => router.push(`/search?q=${encodeURIComponent(query)}`), [router])

  return <SearchBox className={styles.search} inputClassName={styles.search__input} onSubmit={handleSubmit} />
}

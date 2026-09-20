'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useConnection } from 'wagmi'
import clsx from 'clsx'
import Post from '@/components/Post'
import Profile from '@/components/Profile'
import EmptyState from '@/components/ui/EmptyState'
import SearchBox, { MIN_SEARCH_LENGTH, profileHref } from '@/components/SearchBox'
import useRecipientSuggestions from '@/hooks/useRecipientSuggestions'
import styles from '../page.module.scss'

const PERSON_AVATAR_SIZE = 40

/**
 * The /search results page. The box is the shared SearchBox — people suggest under it as you
 * type, the same as in the home header — and a submit commits the query here: posts are
 * fetched, the people who match are laid out above them, and ?q= is written into the URL so
 * the page can be reloaded or shared. A ?q= on load commits straight away.
 */
export default function SearchPanel() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // The route only computes has_liked for a viewer, so results refetch when the wallet arrives
  const { address } = useConnection()

  const [committedQuery, setCommittedQuery] = useState((searchParams.get('q') || '').trim())
  const [results, setResults] = useState([])
  const [isLoadingPosts, setIsLoadingPosts] = useState(false)

  const isCommitted = committedQuery.length >= MIN_SEARCH_LENGTH
  // Same SWR key as the box's typeahead, so committing what was just typed costs no second request
  const { suggestions: people, isLoading: isLoadingPeople } = useRecipientSuggestions({
    query: committedQuery,
    viewer: address,
    enabled: isCommitted,
  })

  const handleSubmit = useCallback((query) => {
    setCommittedQuery(query)
    // replaceState keeps the loading boundary quiet; a router.push here would remount the page
    const url = new URL(window.location.href)
    url.searchParams.set('q', query)
    window.history.replaceState(window.history.state, '', url)
  }, [])

  useEffect(() => {
    if (!isCommitted) {
      setResults([])
      setIsLoadingPosts(false)
      return
    }

    const controller = new AbortController()
    const fetchPosts = async () => {
      setIsLoadingPosts(true)
      const params = new URLSearchParams({ q: committedQuery })
      if (address) params.set('viewer_address', address)
      try {
        const res = await fetch(`/api/v1/search?${params}`, { signal: controller.signal })
        const json = await res.json()
        if (controller.signal.aborted) return
        setResults(json.success ? json.data : [])
      } catch {
        if (controller.signal.aborted) return
        setResults([])
      }
      setIsLoadingPosts(false)
    }

    fetchPosts()
    return () => controller.abort()
  }, [committedQuery, isCommitted, address])

  const hasPeople = isCommitted && people.length > 0
  const hasPosts = isCommitted && results.length > 0
  const isSettled = isCommitted && !isLoadingPosts && !isLoadingPeople

  return (
    <div className={`__container ${styles.page__container}`} data-width="small">
      <SearchBox
        initialQuery={committedQuery}
        className={clsx(styles.search, 'rounded-full')}
        placeholder="Search the multichain..."
        onSubmit={handleSubmit}
      />

      <div className={styles.results}>
        {hasPeople && (
          <section className={clsx(styles.people, 'animate fade')} aria-label="People">
            <h2 className={styles.sectionTitle}>People</h2>
            <ul className={styles.people__list}>
              {people.map((person) => (
                <li
                  key={person.address}
                  className={styles.person}
                  onClick={() => router.push(profileHref(person))}
                  onMouseEnter={() => router.prefetch(profileHref(person))}
                  onTouchStart={() => router.prefetch(profileHref(person))}
                >
                  <Profile creator={person.address} variant="fullWithoutTime" size={PERSON_AVATAR_SIZE} hoverCard={false} />
                  {person.ensName && <code className={styles.person__ens}>{person.ensName}</code>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {(hasPosts || (isCommitted && isLoadingPosts)) && <h2 className={styles.sectionTitle}>Posts</h2>}

        {isCommitted && isLoadingPosts && !hasPosts && <p className={styles.pending}>Searching posts…</p>}

        {hasPosts &&
          results.map((item, i) => (
            <section
              key={`${item.network_id}:${item.id}`}
              className={`${styles.postWrapper} animate fade`}
              onClick={() => router.push(`/networks/${item.network_id}/${item.id}`)}
              onMouseEnter={() => router.prefetch(`/networks/${item.network_id}/${item.id}`)}
              onTouchStart={() => router.prefetch(`/networks/${item.network_id}/${item.id}`)}
            >
              <Post item={item} networkName={item.network_name} actions={['like', 'comment', 'share', 'repost', 'tip', 'bookmark']} />
              {i < results.length - 1 && <hr className={styles.divider} />}
            </section>
          ))}

        {isSettled && hasPeople && !hasPosts && (
          <EmptyState align="center" className={styles.emptyState}>
            No posts found matching "{committedQuery}"
          </EmptyState>
        )}

        {isSettled && !hasPeople && !hasPosts && (
          <EmptyState align="center" size="lg" className={styles.emptyState}>
            No posts or people found matching "{committedQuery}"
          </EmptyState>
        )}
      </div>
    </div>
  )
}

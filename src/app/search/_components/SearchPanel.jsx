'use client'

import { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useConnection } from 'wagmi'
import clsx from 'clsx'
import { ClockCounterClockwiseIcon, MagnifyingGlassIcon, UsersIcon, XIcon } from '@phosphor-icons/react'
import { PostCard } from '@/components/Post'
import Profile from '@/components/Profile'
import EmptyState from '@/components/ui/EmptyState'
import FeedError from '@/components/ui/FeedError'
import SegmentedControl from '@/components/ui/SegmentedControl'
import { PostSkeleton } from '@/components/ui/PostSkeleton'
import SearchBox, { MIN_SEARCH_LENGTH, profileHref } from '@/components/SearchBox'
import useRecipientSuggestions from '@/hooks/useRecipientSuggestions'
import { useFeedScrollRestore } from '@/hooks/useFeedScrollRestore'
import { useFeedCacheStore } from '@/stores/useFeedCacheStore'
import { usePostStore } from '@/stores/usePostStore'
import { rememberCardPointerDown, isTextSelectionDrag } from '@/lib/cardClick'
import styles from '../page.module.scss'

const PERSON_AVATAR_SIZE = 40
const SEARCH_CACHE_KEY = 'search'
// The search route caps posts at this many rows, so a full page means "at least this many"
const POSTS_PAGE_SIZE = 20
// How many people the All tab previews before handing off to the People tab
const PEOPLE_PREVIEW_COUNT = 3
const SKELETON_COUNT = 4
const RECENT_STORAGE_KEY = 'hup:recent-searches'
const RECENT_LIMIT = 8

const TABS = { all: 'all', posts: 'posts', people: 'people' }

const postKey = (post) => `${post.network_id}:${post.id}`

// Recent searches are a per-browser convenience; storage can be missing or throw (private
// windows, blocked site data), and the page works the same without it. Read through
// useSyncExternalStore so the server render and hydration agree on an empty list.
const recentListeners = new Set()

const subscribeRecent = (listener) => {
  recentListeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    recentListeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

// The raw string, so the snapshot stays referentially stable between reads
const getRecentSnapshot = () => {
  try {
    return localStorage.getItem(RECENT_STORAGE_KEY) || '[]'
  } catch {
    return '[]'
  }
}

const getRecentServerSnapshot = () => '[]'

const parseRecent = (raw) => {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}

const writeRecent = (list) => {
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* storage unavailable */
  }
  recentListeners.forEach((listener) => listener())
}

const pushRecent = (query) => {
  const previous = parseRecent(getRecentSnapshot())
  writeRecent([query, ...previous.filter((item) => item.toLowerCase() !== query.toLowerCase())].slice(0, RECENT_LIMIT))
}

const formatCount = (count, isCapped) => (count === 0 ? '' : ` ${count}${isCapped ? '+' : ''}`)

/**
 * The /search results page. The box is the shared SearchBox — people suggest under it as you
 * type, the same as in the home header — and a submit commits the query here: posts are
 * fetched, the people who match are laid out beside them under All / Posts / People tabs, and
 * ?q= is written into the URL so the page can be reloaded or shared. A ?q= on load commits
 * straight away.
 *
 * Like the home feed, the page survives navigation: the committed query, its posts, the open
 * tab and the reader's place go into the in-memory feed cache on exit, and a return within the
 * cache window repaints all of it in place instead of searching again.
 */
export default function SearchPanel() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const setCurrentPost = usePostStore((state) => state.setCurrentPost)
  // The route only computes has_liked for a viewer, so results refetch when the wallet arrives
  const { address } = useConnection()
  const saveFeedCache = useFeedCacheStore((state) => state.saveFeedCache)

  const urlQuery = (searchParams.get('q') || '').trim()

  // A snapshot from an earlier visit this session. Reused when the URL asks for the same query,
  // or for none at all (the sidebar's Search link lands on the bare route).
  const [initialCache] = useState(() => {
    const cached = useFeedCacheStore.getState().readFeedCache(SEARCH_CACHE_KEY, address ?? null)
    if (!cached) return null
    return !urlQuery || urlQuery === cached.query ? cached : null
  })

  const [committedQuery, setCommittedQuery] = useState(initialCache?.query ?? urlQuery)
  const [results, setResults] = useState(initialCache?.list ?? [])
  const [tab, setTab] = useState(initialCache?.tab ?? TABS.all)
  const [isLoadingPosts, setIsLoadingPosts] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)
  // Remounts the box when a query is committed from outside it (a recent-search chip, a header
  // search while already here), so its text follows; a submit from the box already shows it.
  const [boxKey, setBoxKey] = useState(0)
  const [prevUrlQuery, setPrevUrlQuery] = useState(urlQuery)

  const recentRaw = useSyncExternalStore(subscribeRecent, getRecentSnapshot, getRecentServerSnapshot)
  const recent = useMemo(() => parseRecent(recentRaw), [recentRaw])

  // A search from the header while already here lands as a new ?q= on this same mount.
  if (urlQuery !== prevUrlQuery) {
    setPrevUrlQuery(urlQuery)
    if (urlQuery && urlQuery !== committedQuery) {
      setCommittedQuery(urlQuery)
      setResults([])
      setTab(TABS.all)
      setBoxKey((key) => key + 1)
    }
  }

  const isCommitted = committedQuery.length >= MIN_SEARCH_LENGTH
  // Same SWR key as the box's typeahead, so committing what was just typed costs no second request
  const { suggestions: people, isLoading: isLoadingPeople } = useRecipientSuggestions({
    query: committedQuery,
    viewer: address,
    enabled: isCommitted,
  })

  // Which query/viewer pair the current results belong to; a restored snapshot already counts.
  const appliedParamsRef = useRef(initialCache ? `${address ?? null}|${initialCache.query}|0` : null)
  const cacheSnapshotRef = useRef(null)
  const containerRef = useRef(null)
  const { snapshot, containerStyle, cardStyle, clearReservations } = useFeedScrollRestore({
    containerRef,
    restore: initialCache,
    ready: results.length > 0,
  })

  useEffect(() => {
    if (committedQuery.length >= MIN_SEARCH_LENGTH) pushRecent(committedQuery)
  }, [committedQuery])

  // A restore onto the bare route puts the query back in the URL, so reload and share still work.
  useEffect(() => {
    if (!initialCache || urlQuery) return
    const url = new URL(window.location.href)
    url.searchParams.set('q', initialCache.query)
    window.history.replaceState(window.history.state, '', url)
    // Runs once for the snapshot this mount restored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    cacheSnapshotRef.current = { query: committedQuery, list: results, tab, address: address ?? null }
  })

  useEffect(() => {
    return () => {
      const state = cacheSnapshotRef.current
      if (!state || state.query.length < MIN_SEARCH_LENGTH) return
      saveFeedCache(SEARCH_CACHE_KEY, { ...state, ...snapshot() })
    }
  }, [saveFeedCache, snapshot])

  const commitQuery = useCallback(
    (query) => {
      // Re-submitting the same query keeps its results; the fetch below would not run again
      if (query !== committedQuery) setResults([])
      setCommittedQuery(query)
      setTab(TABS.all)
      clearReservations()
      // replaceState keeps the loading boundary quiet; a router.push here would remount the page.
      // The URL sync above sees urlQuery already equal to the committed query and stays out.
      const url = new URL(window.location.href)
      url.searchParams.set('q', query)
      window.history.replaceState(window.history.state, '', url)
    },
    [clearReservations, committedQuery],
  )

  const handleRecentPick = useCallback(
    (query) => {
      commitQuery(query)
      setBoxKey((key) => key + 1)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    [commitQuery],
  )

  const removeRecent = useCallback((query) => writeRecent(recent.filter((item) => item !== query)), [recent])

  const clearRecent = useCallback(() => writeRecent([]), [])

  const handleRetry = useCallback(() => {
    setLoadError(false)
    setRetryNonce((nonce) => nonce + 1)
  }, [])

  useEffect(() => {
    // Nothing renders outside a committed query, so there is nothing to reset here
    if (!isCommitted) return

    const params = `${address ?? null}|${committedQuery}|${retryNonce}`
    if (appliedParamsRef.current === params) return

    const controller = new AbortController()
    // A new query arrives with its list already cleared by whoever committed it; a viewer change
    // refreshes has_liked under the reader without blanking the page
    const fetchPosts = async () => {
      setIsLoadingPosts(true)
      setLoadError(false)
      const search = new URLSearchParams({ q: committedQuery })
      if (address) search.set('viewer_address', address)
      try {
        const res = await fetch(`/api/v1/search?${search}`, { signal: controller.signal })
        const json = await res.json()
        if (controller.signal.aborted) return
        if (!res.ok || !json.success) throw new Error('Search failed')
        setResults(json.data)
        appliedParamsRef.current = params
      } catch {
        if (controller.signal.aborted) return
        setResults([])
        setLoadError(true)
      }
      setIsLoadingPosts(false)
    }

    fetchPosts()
    return () => controller.abort()
  }, [committedQuery, isCommitted, address, retryNonce])

  const handlePostClick = (item) => {
    setCurrentPost(item)
    router.push(`/networks/${item.network_id}/${item.id}`)
  }

  const prefetchPost = (item) => router.prefetch(`/networks/${item.network_id}/${item.id}`)

  const isPeopleLoading = isCommitted && isLoadingPeople && people.length === 0
  const isPostsLoading = isCommitted && isLoadingPosts && results.length === 0
  const isSettled = isCommitted && !isLoadingPosts && !isLoadingPeople && !loadError
  const hasPeople = isCommitted && people.length > 0
  const hasPosts = isCommitted && results.length > 0
  const isEmpty = isSettled && !hasPeople && !hasPosts

  const showPeople = tab !== TABS.posts
  const showPosts = tab !== TABS.people
  const visiblePeople = tab === TABS.all ? people.slice(0, PEOPLE_PREVIEW_COUNT) : people
  const hiddenPeopleCount = people.length - visiblePeople.length

  const tabOptions = [
    { value: TABS.all, label: 'All' },
    { value: TABS.posts, label: `Posts${formatCount(results.length, results.length >= POSTS_PAGE_SIZE)}` },
    { value: TABS.people, label: `People${formatCount(people.length, false)}` },
  ]

  return (
    <div className={clsx('__container', styles.page__container)} data-width="small" ref={containerRef} style={containerStyle}>
      <div className={styles.toolbar}>
        <SearchBox
          key={boxKey}
          initialQuery={committedQuery}
          className={clsx(styles.search, 'rounded-full')}
          placeholder="Search posts and people across every chain"
          onSubmit={commitQuery}
        />

        {isCommitted && (
          <SegmentedControl
            as="tabs"
            label="Search results"
            size="sm"
            options={tabOptions}
            value={tab}
            onChange={setTab}
            className={styles.toolbar__tabs}
          />
        )}
      </div>

      {!isCommitted && (
        <div className={clsx(styles.idle, 'animate fade')}>
          {recent.length > 0 ? (
            <section className={styles.recent} aria-label="Recent searches">
              <header className={styles.section__header}>
                <h2 className={styles.sectionTitle}>Recent</h2>
                <button type="button" className={styles.section__action} onClick={clearRecent}>
                  Clear all
                </button>
              </header>
              <ul className={styles.recent__list}>
                {recent.map((item) => (
                  <li key={item} className={styles.recent__item}>
                    <button type="button" className={styles.recent__query} onClick={() => handleRecentPick(item)}>
                      <ClockCounterClockwiseIcon size={16} aria-hidden="true" />
                      <span>{item}</span>
                    </button>
                    <button type="button" className={styles.recent__remove} aria-label={`Remove "${item}" from recent searches`} onClick={() => removeRecent(item)}>
                      <XIcon size={14} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <EmptyState align="center" size="lg" icon={MagnifyingGlassIcon} className={styles.emptyState}>
              Find posts by what they say, or people by handle, name, ENS or Universal Profile.
            </EmptyState>
          )}
        </div>
      )}

      {isCommitted && (
        <div className={styles.results}>
          {showPeople && (isPeopleLoading || hasPeople) && (
            <section className={clsx(styles.people, tab === TABS.people && styles['people--full'])} aria-label="People">
              {tab === TABS.all && (
                <header className={styles.section__header}>
                  <h2 className={styles.sectionTitle}>People</h2>
                  {hiddenPeopleCount > 0 && (
                    <button type="button" className={styles.section__action} onClick={() => setTab(TABS.people)}>
                      See all {people.length}
                    </button>
                  )}
                </header>
              )}

              {isPeopleLoading ? (
                <ul className={styles.people__list} aria-hidden="true">
                  {Array.from({ length: PEOPLE_PREVIEW_COUNT }).map((_, i) => (
                    <li key={i} className={styles.personSkeleton}>
                      <span className={clsx('shimmer', styles.personSkeleton__avatar)} />
                      <span className={clsx('shimmer', styles.personSkeleton__bar)} />
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className={styles.people__list}>
                  {visiblePeople.map((person) => (
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
              )}
            </section>
          )}

          {tab === TABS.people && isSettled && !hasPeople && (
            <EmptyState align="center" size="lg" icon={UsersIcon} className={styles.emptyState}>
              No people found matching “{committedQuery}”
            </EmptyState>
          )}

          {showPosts && (
            <section className={styles.posts} aria-label="Posts" aria-busy={isLoadingPosts}>
              {tab === TABS.all && (hasPosts || isPostsLoading) && <h2 className={styles.sectionTitle}>Posts</h2>}

              {isPostsLoading && (
                <div aria-hidden="true">
                  {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                    <PostSkeleton key={i} variant={i} divided={i < SKELETON_COUNT - 1} />
                  ))}
                </div>
              )}

              {loadError && <FeedError message="Search didn’t go through." onRetry={handleRetry} isRetrying={isLoadingPosts} />}

              {results.map((item, i) => (
                <section
                  key={postKey(item)}
                  // What the scroll restore anchors to and measures; see useFeedScrollRestore.
                  data-post-key={postKey(item)}
                  style={cardStyle(postKey(item))}
                  // Restored results repaint in place — no entrance replay.
                  className={clsx(styles.post, !initialCache && ['animate', 'fade'])}
                  onPointerDown={rememberCardPointerDown}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (isTextSelectionDrag(e)) return
                    handlePostClick(item)
                  }}
                  onMouseEnter={() => prefetchPost(item)}
                  onTouchStart={() => prefetchPost(item)}
                >
                  <PostCard item={item} networkName={item.network_name} actions={['like', 'comment', 'share', 'repost', 'tip', 'bookmark']} />
                  {i < results.length - 1 && <hr className={styles.divider} />}
                </section>
              ))}

              {tab === TABS.posts && isSettled && !hasPosts && (
                <EmptyState align="center" size="lg" icon={MagnifyingGlassIcon} className={styles.emptyState}>
                  No posts found matching “{committedQuery}”
                </EmptyState>
              )}

              {tab === TABS.all && isSettled && hasPeople && !hasPosts && (
                <EmptyState align="center" className={styles.emptyState}>
                  No posts found matching “{committedQuery}”
                </EmptyState>
              )}
            </section>
          )}

          {tab === TABS.all && isEmpty && (
            <EmptyState align="center" size="lg" icon={MagnifyingGlassIcon} className={styles.emptyState}>
              No posts or people found matching “{committedQuery}”. Try a shorter or different word.
            </EmptyState>
          )}
        </div>
      )}
    </div>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
import clsx from 'clsx'
import { ArticleIcon, ClockIcon, MagnifyingGlassIcon, PencilSimpleIcon, XIcon } from '@phosphor-icons/react'
import Profile from '@/components/Profile'
import { Spinner } from '@/components/Loading'
import { articlePath, readingTimeLabel } from '@/lib/article'
import { resolveIPFSImageUrl } from '@/lib/storageHelper'
import { handleBrokenImage } from '@/lib/utils'
import styles from './ArticlesDirectory.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

const PAGE_SIZE = 24

// Tags shown on a row. The rail above carries the full set; a row only needs enough to say
// what the piece is about, and a third chip starts wrapping the byline on a phone.
const ROW_TAG_LIMIT = 2

// Same shape a loaded row holds — title, two excerpt lines, thumbnail, byline — so the first
// page lands without the list jumping
const SkeletonEntry = () => (
  <li className={styles.entry} aria-hidden="true">
    <div className={styles.entry__link}>
      <div className={styles.entry__text}>
        <div className="shimmer rounded" style={{ width: '75%', height: '18px' }} />
        <div className="shimmer rounded" style={{ width: '100%', height: '12px', marginTop: '0.6rem' }} />
        <div className="shimmer rounded" style={{ width: '60%', height: '12px', marginTop: '0.4rem' }} />
      </div>
      <div className={clsx('shimmer', styles.entry__cover)} />
    </div>
    <div className={styles.entry__meta}>
      <div className="shimmer rounded-full" style={{ width: '24px', height: '24px' }} />
      <div className="shimmer rounded" style={{ width: '8rem', height: '12px' }} />
    </div>
  </li>
)

/**
 * Articles Directory
 *
 * The index behind /articles. Everything it lists comes from the posts table — an article is a
 * post carrying an `article` reference — so this needs no table and no indexer of its own.
 *
 * Filtering is client-driven but server-executed: the tag and query go into the request rather
 * than filtering a page that was already fetched, or the counts would lie the moment there is
 * more than one page of articles.
 */
export default function ArticlesDirectory() {
  const [tag, setTag] = useState(null)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')

  // Debounce the query so SWR refetches settle instead of firing per keystroke
  useEffect(() => {
    const timeout = setTimeout(() => setSearch(query.trim()), 350)
    return () => clearTimeout(timeout)
  }, [query])

  const getKey = (pageIndex, previousPage) => {
    if (previousPage && !previousPage.meta?.hasMore) return null
    const params = new URLSearchParams({ page: String(pageIndex + 1), limit: String(PAGE_SIZE) })
    if (tag) params.set('tag', tag)
    if (search) params.set('q', search)
    return `/api/v1/articles?${params.toString()}`
  }

  const { data: pages, error, isLoading, isValidating, size, setSize, mutate } = useSWRInfinite(getKey, fetcher, {
    revalidateFirstPage: false,
  })

  const articles = useMemo(() => (pages ?? []).flatMap((page) => page?.data ?? []), [pages])
  const hasMore = Boolean(pages?.[pages.length - 1]?.meta?.hasMore)
  const isLoadingMore = isValidating && size > (pages?.length ?? 0)
  const failed = Boolean(error) || pages?.some((page) => page?.success === false)

  /* The tag rail has to come from the UNFILTERED set, or picking a tag would collapse the rail to
     that one tag and strand the reader with no way back to the others. With no filters applied
     this is the same URL as the first infinite page, so SWR dedupes the two. */
  const { data: unfiltered } = useSWR(`/api/v1/articles?page=1&limit=${PAGE_SIZE}`, fetcher)
  const knownTags = useMemo(() => {
    const counts = new Map()
    for (const article of unfiltered?.data || []) {
      for (const t of article.tags || []) counts.set(t, (counts.get(t) || 0) + 1)
    }
    // Most-used first, so the rail opens on the subjects people actually write about
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)
  }, [unfiltered])

  const clearSearch = () => {
    setQuery('')
    setSearch('')
  }

  const clearFilters = () => {
    setTag(null)
    clearSearch()
  }

  const pickTag = (next) => {
    setTag((current) => (current === next ? null : next))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const hasFilters = Boolean(tag || search)
  // The newest piece leads with its cover at full width — but only on the unfiltered front page,
  // where "newest" is the editorial order. In a filtered list it would just be the first match.
  const lead = !hasFilters && articles[0]?.cover ? articles[0] : null
  const rest = lead ? articles.slice(1) : articles

  const renderMeta = (article) => (
    <div className={styles.entry__meta}>
      {/* Outside the link, so the byline keeps its own click target through to the author.
          The timestamp is Profile's to render — `full` draws the author, the verification
          mark and the relative time as one unit, which is the byline the feed shows. Read time
          is not Profile's, so it stays here. */}
      <Profile
        creator={article.wallet_address}
        networkId={article.network_id}
        createdAt={article.created_at}
        variant="full"
      />
      <span className={styles.entry__dot} aria-hidden="true">
        ·
      </span>
      <span className={styles.entry__read}>
        <ClockIcon size={12} />
        {readingTimeLabel(article.wordCount)}
      </span>
      {article.tags?.slice(0, ROW_TAG_LIMIT).map((t) => (
        <button
          key={t}
          type="button"
          className={clsx(styles.entry__tag, tag === t && styles.entry__tag_active)}
          onClick={() => pickTag(t)}
        >
          #{t}
        </button>
      ))}
    </div>
  )

  return (
    <div className={styles.directory}>
      <header className={styles.directory__header}>
        <div>
          <h1 className={styles.directory__title}>Articles</h1>
          <p className={styles.directory__lede}>Long-form writing, published onchain as posts.</p>
        </div>

        <Link href="/compose/article" className={styles.directory__write}>
          <PencilSimpleIcon size={16} />
          <span>Write</span>
        </Link>
      </header>

      <div className={styles.directory__toolbar}>
        <form className={styles.directory__search} onSubmit={(e) => e.preventDefault()} role="search">
          <MagnifyingGlassIcon size={16} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && clearSearch()}
            placeholder="Search titles and excerpts"
            aria-label="Search articles"
            autoComplete="off"
            dir="auto"
          />
          {isValidating && search && !isLoadingMore ? (
            <Spinner size={14} label="Searching" />
          ) : (
            query && (
              <button type="button" onClick={clearSearch} aria-label="Clear search">
                <XIcon size={14} />
              </button>
            )
          )}
        </form>

        {knownTags.length > 0 && (
          <div className={styles.directory__tags} role="group" aria-label="Filter by tag">
            <button
              type="button"
              aria-pressed={!tag}
              className={clsx(styles.directory__tag, !tag && styles.directory__tag_active)}
              onClick={() => setTag(null)}
            >
              All
            </button>
            {knownTags.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tag === t}
                className={clsx(styles.directory__tag, tag === t && styles.directory__tag_active)}
                onClick={() => pickTag(t)}
              >
                #{t}
              </button>
            ))}
          </div>
        )}
      </div>

      {hasFilters && !isLoading && !failed && articles.length > 0 && (
        <p className={styles.directory__summary} aria-live="polite">
          <span>
            {articles.length}
            {hasMore ? '+' : ''} {articles.length === 1 ? 'article' : 'articles'}
            {tag && (
              <>
                {' '}
                in <strong>#{tag}</strong>
              </>
            )}
            {search && (
              <>
                {' '}
                matching <strong dir="auto">“{search}”</strong>
              </>
            )}
          </span>
          <button type="button" onClick={clearFilters}>
            Clear
          </button>
        </p>
      )}

      {isLoading && (
        <ul className={styles.directory__list} aria-busy="true">
          {Array.from({ length: 5 }).map((_, index) => (
            <SkeletonEntry key={index} />
          ))}
        </ul>
      )}

      {!isLoading && failed && !articles.length && (
        <div className={styles.directory__empty}>
          <ArticleIcon size={28} />
          <p>Articles couldn’t be loaded.</p>
          <button type="button" onClick={() => mutate()}>
            Try again
          </button>
        </div>
      )}

      {!isLoading && !failed && !articles.length && (
        <div className={styles.directory__empty}>
          <ArticleIcon size={28} />
          <p>{hasFilters ? 'No articles match that.' : 'No articles yet.'}</p>
          {hasFilters ? (
            <button type="button" onClick={clearFilters}>
              Clear filters
            </button>
          ) : (
            <Link href="/compose/article">Write the first one</Link>
          )}
        </div>
      )}

      {lead && (
        <article className={styles.lead}>
          <Link href={articlePath(lead.network_id, lead.id, lead.title)} className={styles.lead__link}>
            <div className={styles.lead__cover}>
              <img
                src={resolveIPFSImageUrl(lead.cover, { width: 960 })}
                alt=""
                fetchPriority="high"
                onError={handleBrokenImage}
              />
            </div>
            <span className={styles.lead__label}>Latest</span>
            <h2 className={styles.lead__title} dir="auto">
              {lead.title}
            </h2>
            {(lead.subtitle || lead.excerpt) && (
              <p className={styles.lead__excerpt} dir="auto">
                {lead.subtitle || lead.excerpt}
              </p>
            )}
          </Link>
          {renderMeta(lead)}
        </article>
      )}

      {!isLoading && rest.length > 0 && (
        <ul className={styles.directory__list}>
          {rest.map((article) => {
            const cover = article.cover ? resolveIPFSImageUrl(article.cover, { width: 480 }) : null

            return (
              <li key={`${article.network_id}:${article.id}`} className={styles.entry}>
                <Link
                  href={articlePath(article.network_id, article.id, article.title)}
                  className={styles.entry__link}
                >
                  <div className={styles.entry__text}>
                    <h2 className={styles.entry__title} dir="auto">
                      {article.title}
                    </h2>
                    {(article.subtitle || article.excerpt) && (
                      <p className={styles.entry__excerpt} dir="auto">
                        {article.subtitle || article.excerpt}
                      </p>
                    )}
                  </div>

                  {cover && (
                    <div className={styles.entry__cover}>
                      <img src={cover} alt="" loading="lazy" onError={handleBrokenImage} />
                    </div>
                  )}
                </Link>

                {renderMeta(article)}
              </li>
            )
          })}
        </ul>
      )}

      {hasMore && !isLoading && (
        <button
          type="button"
          className={styles.directory__more}
          onClick={() => setSize(size + 1)}
          disabled={isLoadingMore}
        >
          {isLoadingMore ? <Spinner size={16} label="Loading more articles" /> : 'Load more'}
        </button>
      )}
    </div>
  )
}

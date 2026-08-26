'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { ArticleIcon, ClockIcon, MagnifyingGlassIcon, PencilSimpleIcon, XIcon } from '@phosphor-icons/react'
import Profile from '@/components/Profile'
import { articlePath, readingTimeLabel } from '@/lib/article'
import { resolveIPFSImageUrl } from '@/lib/storageHelper'
import { handleBrokenImage } from '@/lib/utils'
import styles from './ArticlesDirectory.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

const PAGE_SIZE = 24

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

  const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
  if (tag) params.set('tag', tag)
  if (search) params.set('q', search)

  const { data, isLoading } = useSWR(`/api/v1/articles?${params.toString()}`, fetcher)
  const articles = data?.data || []

  /* The tag rail has to come from the UNFILTERED set, or picking a tag would collapse the rail to
     that one tag and strand the reader with no way back to the others. With no filters applied
     this key is identical to the one above, so SWR serves both from one request. */
  const { data: unfiltered } = useSWR(`/api/v1/articles?limit=${PAGE_SIZE}`, fetcher)
  const knownTags = useMemo(() => {
    const seen = new Set()
    for (const article of unfiltered?.data || []) for (const t of article.tags || []) seen.add(t)
    return [...seen]
  }, [unfiltered])

  const submitSearch = (event) => {
    event.preventDefault()
    setSearch(query.trim())
  }

  const clearFilters = () => {
    setTag(null)
    setQuery('')
    setSearch('')
  }

  const hasFilters = Boolean(tag || search)

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

      <form className={styles.directory__search} onSubmit={submitSearch} role="search">
        <MagnifyingGlassIcon size={16} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search articles"
          aria-label="Search articles"
          dir="auto"
        />
        {hasFilters && (
          <button type="button" onClick={clearFilters} aria-label="Clear filters">
            <XIcon size={14} />
          </button>
        )}
      </form>

      {knownTags.length > 0 && (
        <div className={styles.directory__tags}>
          <button
            type="button"
            className={clsx(styles.directory__tag, !tag && styles.directory__tag_active)}
            onClick={() => setTag(null)}
          >
            All
          </button>
          {knownTags.map((t) => (
            <button
              key={t}
              type="button"
              className={clsx(styles.directory__tag, tag === t && styles.directory__tag_active)}
              onClick={() => setTag(tag === t ? null : t)}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {isLoading && <p className={styles.directory__status}>Loading articles…</p>}

      {!isLoading && !articles.length && (
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

      <ul className={styles.directory__list}>
        {articles.map((article) => {
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

              {/* Outside the link, so the byline keeps its own click target through to the author.
                  The timestamp is Profile's to render — `full` draws the author, the verification
                  mark and the relative time as one unit, which is the byline the feed shows. A
                  hand-rolled <time> beside it was a second copy of that logic, free to drift in
                  format and to disagree about what "2d" means. Read time is not Profile's, so it
                  stays here. */}
              <div className={styles.entry__meta}>
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
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

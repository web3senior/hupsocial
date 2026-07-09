'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { ArrowSquareOutIcon, CodeIcon, GlobeIcon, LinkSimpleIcon, MagnifyingGlassIcon, SquaresFourIcon } from '@phosphor-icons/react'
import PageTitle from '@/components/PageTitle'
import clsx from 'clsx'
import styles from './page.module.scss'

const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const fetcher = async (url) => {
  const response = await fetch(url)
  const json = await response.json()

  if (!response.ok || !json.success) {
    throw new Error(json.error || 'Apps failed to load')
  }

  return json
}

export default function AppsPage() {
  const [categoryId, setCategoryId] = useState('all')
  const [networkId, setNetworkId] = useState('all')
  const [query, setQuery] = useState('')

  const { data, error, isLoading } = useSWR('/api/v1/apps', fetcher)

  const apps = useMemo(() => data?.data || [], [data])
  const categories = data?.meta?.categories || []
  const networks = data?.meta?.networks || []
  const total = data?.meta?.total || 0

  const filteredApps = useMemo(() => {
    const search = query.trim().toLowerCase()

    return apps.filter((app) => {
      if (categoryId !== 'all' && app.category.id !== categoryId) return false
      if (networkId !== 'all' && app.network.id !== networkId) return false
      if (!search) return true

      const haystack = [app.name, app.description, app.category.name, app.network.name, ...app.tags].filter(Boolean).join(' ').toLowerCase()

      return haystack.includes(search)
    })
  }, [apps, categoryId, networkId, query])

  return (
    <>
      <PageTitle name="Apps" />
      <div className={clsx(styles.page, 'animate', 'fade')}>
        <div className={`__container`} data-width="medium">
          <header className={styles.page__header}>
            <label className={clsx(styles.search, 'rounded-full')}>
              <MagnifyingGlassIcon size={18} aria-hidden="true" />
              <input
                type="search"
                className={styles.search__input}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search"
                aria-label="Search apps"
              />
            </label>
          </header>
        </div>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          <div className={styles.filterbar}>
            <nav className={styles.filters} aria-label="App categories">
              <button
                type="button"
                className={clsx(styles.filters__chip, categoryId === 'all' && styles['filters__chip--active'])}
                onClick={() => setCategoryId('all')}
              >
                <SquaresFourIcon size={14} aria-hidden="true" />
                <span>All</span>
                <small>{total}</small>
              </button>

              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={clsx(styles.filters__chip, categoryId === category.id && styles['filters__chip--active'])}
                  onClick={() => setCategoryId(category.id)}
                >
                  <span>{category.name}</span>
                  <small>{category.app_count}</small>
                </button>
              ))}
            </nav>

            {networks.length > 0 && (
              <nav className={styles.filters} aria-label="App networks">
                <button
                  type="button"
                  className={clsx(styles.filters__chip, networkId === 'all' && styles['filters__chip--active'])}
                  onClick={() => setNetworkId('all')}
                >
                  <GlobeIcon size={14} aria-hidden="true" />
                  <span>All networks</span>
                </button>

                {networks.map((network) => (
                  <button
                    key={network.id}
                    type="button"
                    className={clsx(styles.filters__chip, networkId === network.id && styles['filters__chip--active'])}
                    onClick={() => setNetworkId(network.id)}
                  >
                    <span>{network.name}</span>
                    <small>{network.app_count}</small>
                  </button>
                ))}
              </nav>
            )}
          </div>

          {error ? (
            <div className={styles.state}>
              <p>{error.message}</p>
            </div>
          ) : isLoading ? (
            <AppsSkeleton />
          ) : filteredApps.length === 0 ? (
            <div className={styles.state}>
              <p>No apps found{query ? ` for "${query}"` : ''}.</p>
            </div>
          ) : (
            <ul className={styles.grid}>
              {filteredApps.map((app) => (
                <AppCard key={app.id} app={app} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}

function AppCard({ app }) {
  return (
    <li className={styles.card}>
      <div className={styles.card__header}>
        <AppLogo name={app.name} logo={app.logo} />

        <div className={styles.card__title}>
          <h3>{app.name}</h3>
          <div className={styles.card__badges}>
            <span className={styles.card__category}>{app.category.name}</span>
            {app.network.name && <span className={styles.card__network}>{app.network.name}</span>}
          </div>
        </div>
      </div>

      {app.description && <p className={styles.card__description}>{app.description}</p>}

      {app.tags.length > 0 && (
        <div className={styles.card__tags}>
          {app.tags.slice(0, 5).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      )}

      <div className={styles.card__footer}>
        {app.url && (
          <a className={clsx(styles.card__visit, 'rounded-full')} href={app.url} target="_blank" rel="noopener noreferrer">
            <span>Open</span>
          </a>
        )}
      </div>
    </li>
  )
}

function AppLogo({ name, logo }) {
  const [failed, setFailed] = useState(false)

  if (!logo || failed) {
    return (
      <span className={styles.card__logoFallback} aria-hidden="true">
        {(name || '?').slice(0, 1).toUpperCase()}
      </span>
    )
  }

  return <img className={styles.card__logo} src={logo} alt={`${name} logo`} loading="lazy" onError={() => setFailed(true)} />
}

function AppsSkeleton() {
  return (
    <div className={styles.skeleton} aria-label="Loading apps">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className={styles.skeleton__card}>
          <span />
          <div />
          <p />
        </div>
      ))}
    </div>
  )
}

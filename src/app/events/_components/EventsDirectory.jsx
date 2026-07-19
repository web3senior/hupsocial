'use client'

import { useMemo, useRef, useState } from 'react'
import useSWRInfinite from 'swr/infinite'
import clsx from 'clsx'
import { CONTRACTS, appChains } from '@/config/contracts'
import { toDayGroupKey, toDayGroupLabel, toTimeRange } from '@/lib/dateHelper'
import ListEventDialog from '@/components/ListEventDialog'
import { ArrowSquareOutIcon, CalendarBlankIcon, MapPinIcon, PlusIcon, StarIcon } from '@phosphor-icons/react'
import styles from './EventsDirectory.module.scss'

const PAGE_SIZE = 25

const fetcher = (url) => fetch(url).then((res) => res.json())

const shortWallet = (wallet) => (wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : '')

const isHttpUrl = (url) => /^https?:\/\//i.test(url || '')

export default function EventsDirectory() {
  const dialogRef = useRef(null)
  const [scope, setScope] = useState('upcoming')
  const [networkId, setNetworkId] = useState('')

  // Chains where the events contract is live — drives the network filter options
  const eventChains = useMemo(() => appChains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.events), [])
  const chainName = (id) => appChains.find((chain) => chain.id === Number(id))?.name || `#${id}`

  const getKey = (pageIndex, previousPage) => {
    if (previousPage && !previousPage.nextPage) return null
    const params = new URLSearchParams({ scope, page: String(pageIndex + 1), limit: String(PAGE_SIZE) })
    if (networkId) params.set('networkId', networkId)
    return `/api/v1/events?${params}`
  }

  const { data: pages, isLoading, isValidating, size, setSize, mutate } = useSWRInfinite(getKey, fetcher, {
    revalidateFirstPage: false,
  })

  const events = useMemo(() => (pages ?? []).flatMap((page) => page?.data ?? []), [pages])
  const featured = pages?.[0]?.meta?.featured ?? []
  const hasMore = Boolean(pages?.[pages.length - 1]?.nextPage)

  // Day groups keyed by the event's own calendar day (its stated time zone, like a
  // conference sheet) — featured rows pinned first inside each day.
  const dayGroups = useMemo(() => {
    const groups = new Map()
    for (const event of events) {
      const start = Number(event.start_time)
      const key = toDayGroupKey(start, event.timezone)
      if (!groups.has(key)) {
        groups.set(key, { label: toDayGroupLabel(start, event.timezone), events: [] })
      }
      groups.get(key).events.push(event)
    }
    for (const group of groups.values()) {
      group.events.sort((a, b) => Number(b.featured) - Number(a.featured) || Number(a.start_time) - Number(b.start_time))
    }
    return [...groups.entries()]
  }, [events])

  const organizerLabel = (event) => event.organizer_name || event.display_name || shortWallet(event.wallet_address)

  const renderRow = (event, inFeaturedStrip = false) => (
    <article
      key={`${event.network_id}-${event.event_id}`}
      className={clsx(styles.directory__row, event.featured && !inFeaturedStrip ? styles['directory__row--featured'] : null)}
    >
      <div className={styles.directory__time}>
        <span>{toTimeRange(Number(event.start_time), Number(event.end_time), event.timezone)}</span>
        {event.timezone && <small>{event.timezone.split('/').pop()?.replace(/_/g, ' ')}</small>}
      </div>

      <div className={styles.directory__details}>
        <h3 className={styles.directory__title}>
          {Boolean(Number(event.featured)) && <StarIcon size={14} weight="fill" className={styles.directory__star} />}
          {event.title || 'Untitled event'}
        </h3>
        <p className={styles.directory__meta}>
          <span>{organizerLabel(event)}</span>
          {(event.venue || event.city) && (
            <span className={styles.directory__venue}>
              <MapPinIcon size={12} />
              {[event.venue, event.city].filter(Boolean).join(', ')}
            </span>
          )}
          <span className={styles.directory__network}>{chainName(event.network_id)}</span>
        </p>
      </div>

      {isHttpUrl(event.registration_url) && (
        <a href={event.registration_url} target="_blank" rel="noopener noreferrer" className={styles.directory__register}>
          Register
          <ArrowSquareOutIcon size={13} />
        </a>
      )}
    </article>
  )

  return (
    <div className={styles.directory}>
      <div className={styles.directory__toolbar}>
        <div className={styles.directory__toggle} role="tablist" aria-label="Event scope">
          {['upcoming', 'past'].map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={scope === option}
              className={clsx(styles.directory__toggleButton, scope === option ? styles['directory__toggleButton--active'] : null)}
              onClick={() => setScope(option)}
            >
              {option === 'upcoming' ? 'Upcoming' : 'Past'}
            </button>
          ))}
        </div>

        {eventChains.length > 1 && (
          <select
            className={styles.directory__networkFilter}
            value={networkId}
            onChange={(e) => setNetworkId(e.target.value)}
            aria-label="Filter by network"
          >
            <option value="">All networks</option>
            {eventChains.map((chain) => (
              <option key={chain.id} value={chain.id}>
                {chain.name}
              </option>
            ))}
          </select>
        )}

        <button type="button" className={styles.directory__listButton} onClick={() => dialogRef.current?.open()}>
          <PlusIcon size={14} />
          List event
        </button>
      </div>

      {scope === 'upcoming' && featured.length > 0 && (
        <section className={styles.directory__featuredStrip} aria-label="Featured events">
          <h2>
            <StarIcon size={14} weight="fill" />
            Featured
          </h2>
          {featured.map((event) => renderRow(event, true))}
        </section>
      )}

      {isLoading && <p className={styles.directory__empty}>Loading events...</p>}

      {!isLoading && events.length === 0 && (
        <div className={styles.directory__empty}>
          <CalendarBlankIcon size={32} />
          <p>{scope === 'upcoming' ? 'No upcoming events yet — be the first to list one.' : 'No past events on record.'}</p>
        </div>
      )}

      {dayGroups.map(([key, group]) => (
        <section key={key} className={styles.directory__dayGroup}>
          <h2 className={styles.directory__dayHeader}>{group.label}</h2>
          {group.events.map((event) => renderRow(event))}
        </section>
      ))}

      {hasMore && (
        <button type="button" className={styles.directory__loadMore} onClick={() => setSize(size + 1)} disabled={isValidating}>
          {isValidating ? 'Loading...' : 'Load more'}
        </button>
      )}

      <ListEventDialog ref={dialogRef} onListed={() => mutate()} />
    </div>
  )
}

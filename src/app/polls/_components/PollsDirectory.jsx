'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import useSWRInfinite from 'swr/infinite'
import clsx from 'clsx'
import { useConnection } from 'wagmi'
import { CONTRACTS, appChains } from '@/config/contracts'
import CreatePollDialog from '@/components/CreatePollDialog'
import { formatVotes, pollOptions, pollStatus, requirementChips, toRelative } from '@/lib/polls'
import { ListChecksIcon, MagnifyingGlassIcon, PlusIcon } from '@phosphor-icons/react'
import styles from './PollsDirectory.module.scss'

const PAGE_SIZE = 25

const fetcher = (url) => fetch(url).then((res) => res.json())

const shortWallet = (wallet) => (wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : '')

/**
 * Polls Directory
 * The /polls index: every indexed poll across the chains HupPolls is deployed on, filtered by
 * lifecycle scope. Cards link through to the poll page rather than accepting a ballot inline —
 * a list is for finding a poll, and voting belongs where the question has room to be read.
 */
export default function PollsDirectory() {
  const dialogRef = useRef(null)
  const { address } = useConnection()
  const [scope, setScope] = useState('open')
  const [networkId, setNetworkId] = useState('')
  const [sort, setSort] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  // Debounce the query so SWR refetches settle instead of firing per keystroke
  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim()), 350)
    return () => clearTimeout(timeout)
  }, [searchInput])

  // Chains where the polls contract is live — drives the network filter options
  const pollChains = useMemo(() => appChains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.polls), [])
  const chainName = (id) => appChains.find((chain) => chain.id === Number(id))?.name || `#${id}`

  const getKey = (pageIndex, previousPage) => {
    if (previousPage && !previousPage.nextPage) return null
    if (scope === 'mine' && !address) return null
    const params = new URLSearchParams({ scope, page: String(pageIndex + 1), limit: String(PAGE_SIZE) })
    if (networkId) params.set('networkId', networkId)
    if (sort) params.set('sort', sort)
    if (address) params.set('participant', address)
    if (search) params.set('q', search)
    return `/api/v1/polls?${params}`
  }

  const {
    data: pages,
    isLoading,
    isValidating,
    size,
    setSize,
    mutate,
  } = useSWRInfinite(getKey, fetcher, { revalidateFirstPage: false })

  const polls = useMemo(() => (pages ?? []).flatMap((page) => page?.data ?? []), [pages])
  const hasMore = Boolean(pages?.[pages.length - 1]?.nextPage)

  const scopes = [
    { key: 'open', label: 'Open' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'closed', label: 'Closed' },
    ...(address ? [{ key: 'mine', label: 'Mine' }] : []),
  ]

  const emptyCopy = {
    open: 'No open polls yet — be the first to ask something.',
    upcoming: 'No upcoming polls scheduled.',
    closed: 'No polls have closed yet.',
    mine: "You haven't created or voted on any polls yet.",
  }

  const renderCard = (poll) => {
    const status = pollStatus(poll)
    const options = pollOptions(poll)
    // The leader is only shown once a poll is closed: revealing it on a live poll would
    // steer the very votes the card is reporting
    const leader = status.key === 'closed' ? options.find((option) => option.isLeader) : null
    const hasVoted = poll.viewer_option !== null && poll.viewer_option !== undefined
    const chips = requirementChips(poll, appChains.find((chain) => chain.id === Number(poll.network_id))?.nativeCurrency?.symbol)

    return (
      <Link key={`${poll.network_id}-${poll.poll_id}`} href={`/polls/${poll.network_id}/${poll.poll_id}`} className={styles.directory__card}>
        <div className={styles.directory__cardTop}>
          <span className={clsx(styles.directory__badge, styles[`directory__badge--${status.key}`])}>{status.label}</span>
          {hasVoted && <span className={styles.directory__voted}>You voted</span>}
          <span className={styles.directory__network}>{chainName(poll.network_id)}</span>
        </div>

        <h3 className={styles.directory__title}>{poll.question || `Poll #${poll.poll_id}`}</h3>

        {/* Same chips the in-post card shows — who is shut out belongs next to the question
            wherever it is read, not only where it can be voted on */}
        {chips.length > 0 && (
          <div className={styles.directory__chips}>
            {chips.map((chip, index) => (
              <span key={index} className={clsx(styles.directory__chip, styles[`directory__chip--${chip.tone}`])}>
                {chip.label}
              </span>
            ))}
          </div>
        )}

        <p className={styles.directory__meta}>
          <span>{poll.display_name || shortWallet(poll.wallet_address)}</span>
          <span>{toRelative(poll.opened_at)}</span>
          {status.key === 'open' && <span>closes {toRelative(poll.closes_at)}</span>}
          {status.key === 'upcoming' && <span>opens {toRelative(poll.opens_at)}</span>}
        </p>

        <p className={styles.directory__stats}>
          <span>
            {formatVotes(poll.total_votes)} {Number(poll.total_votes) === 1 ? 'vote' : 'votes'}
          </span>
          <span>{options.length} options</span>
          {leader && <span className={styles.directory__winner}>Leading: {leader.label}</span>}
        </p>
      </Link>
    )
  }

  return (
    <div className={styles.directory}>
      <div className={styles.directory__toolbar}>
        <div className={styles.directory__toggle} role="tablist" aria-label="Poll scope">
          {scopes.map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={scope === option.key}
              className={clsx(styles.directory__toggleButton, scope === option.key ? styles['directory__toggleButton--active'] : null)}
              onClick={() => setScope(option.key)}
              // data-label feeds the hidden bold ::after that reserves the active width,
              // so toggling bold never shifts the row
              data-label={option.label}
            >
              {option.label}
            </button>
          ))}
        </div>

        {pollChains.length > 1 && (
          <select
            className={styles.directory__networkFilter}
            value={networkId}
            onChange={(e) => setNetworkId(e.target.value)}
            aria-label="Filter by network"
          >
            <option value="">All networks</option>
            {pollChains.map((chain) => (
              <option key={chain.id} value={chain.id}>
                {chain.name}
              </option>
            ))}
          </select>
        )}

        <select className={styles.directory__networkFilter} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort polls">
          <option value="">Default</option>
          <option value="closing">Closing soonest</option>
          <option value="votes">Most votes</option>
          <option value="recent">Newest</option>
        </select>

        <button type="button" className={styles.directory__createButton} onClick={() => dialogRef.current?.open()}>
          <PlusIcon size={14} />
          New poll
        </button>

        <div className={styles.directory__searchRow}>
          <div className={styles.directory__search}>
            <MagnifyingGlassIcon size={14} />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search polls"
              aria-label="Search polls"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
      </div>

      {isLoading && <p className={styles.directory__empty}>Loading polls...</p>}

      {!isLoading && polls.length === 0 && (
        <div className={styles.directory__empty}>
          <ListChecksIcon size={32} />
          <p>{search ? `No polls match “${search}”.` : emptyCopy[scope]}</p>
        </div>
      )}

      {polls.map((poll) => renderCard(poll))}

      {hasMore && (
        <button type="button" className={styles.directory__loadMore} onClick={() => setSize(size + 1)} disabled={isValidating}>
          {isValidating ? 'Loading...' : 'Load more'}
        </button>
      )}

      <CreatePollDialog ref={dialogRef} onCreated={() => mutate()} />
    </div>
  )
}

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import useSWRInfinite from 'swr/infinite'
import clsx from 'clsx'
import { useConnection } from 'wagmi'
import { CONTRACTS, appChains } from '@/config/contracts'
import CreateMarketDialog from '@/components/CreateMarketDialog'
import useStakeToken, { formatStake } from '@/hooks/useStakeToken'
import { marketStatus, parseJsonArray, toRelative } from '@/lib/predict'
import { MagnifyingGlassIcon, PlusIcon, ScalesIcon, TargetIcon, UsersIcon } from '@phosphor-icons/react'
import styles from './PredictDirectory.module.scss'

const PAGE_SIZE = 25

const fetcher = (url) => fetch(url).then((res) => res.json())

const shortWallet = (wallet) => (wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : '')

// Volume needs the stake token's decimals/symbol, so it renders per-card via the shared hook
function MarketVolume({ market }) {
  const { symbol, decimals } = useStakeToken(market.network_id, market.token, Boolean(Number(market.is_token_lsp7)))
  const volume = formatStake(market.total_pool, decimals)
  if (volume === null) return null
  return (
    <span className={styles.directory__volume}>
      {volume} {symbol}
    </span>
  )
}

export default function PredictDirectory() {
  const dialogRef = useRef(null)
  const { address } = useConnection()
  const [scope, setScope] = useState('open')
  const [networkId, setNetworkId] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  // Debounce the query so SWR refetches settle instead of firing per keystroke
  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim()), 350)
    return () => clearTimeout(timeout)
  }, [searchInput])

  // Chains where the predict contract is live — drives the network filter options
  const predictChains = useMemo(() => appChains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.predict), [])
  const chainName = (id) => appChains.find((chain) => chain.id === Number(id))?.name || `#${id}`

  const getKey = (pageIndex, previousPage) => {
    if (previousPage && !previousPage.nextPage) return null
    if (scope === 'mine' && !address) return null
    const params = new URLSearchParams({ scope, page: String(pageIndex + 1), limit: String(PAGE_SIZE) })
    if (networkId) params.set('networkId', networkId)
    if (scope === 'mine') params.set('participant', address)
    if (search) params.set('q', search)
    return `/api/v1/predict?${params}`
  }

  const { data: pages, isLoading, isValidating, size, setSize, mutate } = useSWRInfinite(getKey, fetcher, {
    revalidateFirstPage: false,
  })

  const markets = useMemo(() => (pages ?? []).flatMap((page) => page?.data ?? []), [pages])
  const hasMore = Boolean(pages?.[pages.length - 1]?.nextPage)

  const scopes = [
    { key: 'open', label: 'Open' },
    { key: 'closed', label: 'Awaiting' },
    { key: 'settled', label: 'Settled' },
    ...(address ? [{ key: 'mine', label: 'Mine' }] : []),
  ]

  const emptyCopy = {
    open: 'No open markets yet — be the first to start one.',
    closed: 'No markets are awaiting a result.',
    settled: 'No settled markets yet.',
    mine: "You haven't created, judged, or bet on any markets yet.",
  }

  return (
    <div className={styles.directory}>
      <div className={styles.directory__toolbar}>
        <div className={styles.directory__toggle} role="tablist" aria-label="Market scope">
          {scopes.map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={scope === option.key}
              className={clsx(styles.directory__toggleButton, scope === option.key ? styles['directory__toggleButton--active'] : null)}
              onClick={() => setScope(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className={styles.directory__search}>
          <MagnifyingGlassIcon size={14} />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search markets"
            aria-label="Search markets"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {predictChains.length > 1 && (
          <select
            className={styles.directory__networkFilter}
            value={networkId}
            onChange={(e) => setNetworkId(e.target.value)}
            aria-label="Filter by network"
          >
            <option value="">All networks</option>
            {predictChains.map((chain) => (
              <option key={chain.id} value={chain.id}>
                {chain.name}
              </option>
            ))}
          </select>
        )}

        <button type="button" className={styles.directory__createButton} onClick={() => dialogRef.current?.open()}>
          <PlusIcon size={14} />
          New market
        </button>
      </div>

      {isLoading && <p className={styles.directory__empty}>Loading markets...</p>}

      {!isLoading && markets.length === 0 && (
        <div className={styles.directory__empty}>
          <TargetIcon size={32} />
          <p>{search ? `No markets match “${search}”.` : emptyCopy[scope]}</p>
        </div>
      )}

      {markets.map((market) => {
        const status = marketStatus(market)
        const outcomes = parseJsonArray(market.outcome_labels)

        return (
          <Link
            key={`${market.network_id}-${market.market_id}`}
            href={`/predict/${market.network_id}/${market.market_id}`}
            className={styles.directory__card}
          >
            <div className={styles.directory__cardTop}>
              <span className={clsx(styles.directory__badge, styles[`directory__badge--${status.key}`])}>{status.label}</span>
              <span className={styles.directory__network}>{chainName(market.network_id)}</span>
            </div>

            <h3 className={styles.directory__title}>{market.title || 'Untitled market'}</h3>

            <p className={styles.directory__meta}>
              <span>{market.display_name || shortWallet(market.wallet_address)}</span>
              <span>{toRelative(market.opened_at)}</span>
              {status.key === 'open' && <span>closes {toRelative(market.betting_deadline)}</span>}
            </p>

            <p className={styles.directory__stats}>
              <MarketVolume market={market} />
              <span className={styles.directory__outcomes}>
                <UsersIcon size={12} />
                {outcomes.length || market.outcome_count} outcomes
              </span>
              {status.key === 'resolved' && market.winning_outcome !== null && (
                <span className={styles.directory__winner}>
                  <ScalesIcon size={12} />
                  {outcomes[Number(market.winning_outcome)]?.label || `Outcome #${Number(market.winning_outcome) + 1}`}
                </span>
              )}
            </p>
          </Link>
        )
      })}

      {hasMore && (
        <button type="button" className={styles.directory__loadMore} onClick={() => setSize(size + 1)} disabled={isValidating}>
          {isValidating ? 'Loading...' : 'Load more'}
        </button>
      )}

      <CreateMarketDialog ref={dialogRef} onCreated={() => mutate()} />
    </div>
  )
}

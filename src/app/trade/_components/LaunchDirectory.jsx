'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { useConnection } from 'wagmi'
import { CONTRACTS } from '@/config/wagmi'
import { useActiveChain } from '@/hooks/useActiveChain'
import useStoredChoice from '@/hooks/useStoredChoice'
import { formatCount } from '@/lib/launch'
import CreateLaunchDialog from '@/components/CreateLaunchDialog'
import NetworkSelect from '@/components/ui/NetworkSelect'
import SegmentedControl from '@/components/ui/SegmentedControl'
import EmptyState from '@/components/ui/EmptyState'
import LaunchGrid from './LaunchGrid'
import LaunchTable from './LaunchTable'
import QuickBuyBar from './QuickBuyBar'
import { ArrowsLeftRightIcon, CoinIcon, GridFourIcon, ListDashesIcon, MagnifyingGlassIcon, RocketLaunchIcon } from '@phosphor-icons/react'
import styles from './LaunchDirectory.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

const SORTS = [
  { key: 'vol24h', label: '24h volume' },
  { key: 'mcap', label: 'Market cap' },
  { key: 'recent', label: 'Recent trades' },
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
]

// What a row is, not where it ranks. "All" is every tradable token on every chain Hup speaks;
// the other two are the sets worth reaching in one press.
const SOURCES = [
  { key: 'all', label: 'All', hint: 'Every tradable token across all chains' },
  { key: 'hup', label: 'Hup', hint: 'Tokens launched on Hup — one-press buy' },
  { key: 'stock', label: 'Stocks', hint: 'Tokenized equities' },
]

const VIEWS = [
  { value: 'grid', label: 'Grid', icon: GridFourIcon },
  { value: 'list', label: 'List', icon: ListDashesIcon },
]

const VIEW_VALUES = VIEWS.map((view) => view.value)

const PAGE_SIZE = 50

/**
 * Launch Directory
 * The standalone home for token launches: browse everything live across every chain, and launch
 * one without composing a post. The composer flow stays the primary path — a launch that arrives
 * with a post gets distribution the moment it exists — but a token still needs somewhere to live
 * for people who arrive from a link rather than the feed.
 *
 * Two views over one list. The grid is for recognising something; the table is for comparing
 * things, which is a different job and needs every figure at the same distance from its
 * neighbours. Both read the same fetch, so switching costs nothing and refetches nothing.
 *
 * The list is deliberately not filtered to the connected chain. A launchpad that shows nothing
 * until you switch networks looks empty rather than multichain, and each row carries its own
 * chain's colour so where a token lives is read rather than assumed.
 */
const LaunchDirectory = () => {
  const createDialogRef = useRef(null)
  const { address } = useConnection()
  const { chainId } = useActiveChain()

  const [sort, setSort] = useState('vol24h')
  const [query, setQuery] = useState('')
  const [mineOnly, setMineOnly] = useState(false)
  const [source, setSource] = useState('all')
  const [view, setView] = useStoredChoice('launch-explorer-view', VIEW_VALUES, 'grid')

  const launchAddress = CONTRACTS[`chain${chainId}`]?.launch
  const needsCreator = mineOnly && !address

  // Every chain at once by default. A launchpad filtered to the connected wallet's network looks
  // empty rather than multichain, so the network picker narrows the set rather than defining it.
  const params = new URLSearchParams({ sort, source, limit: String(PAGE_SIZE) })
  if (query.trim()) params.set('q', query.trim())
  if (mineOnly && address) params.set('creator', address.toLowerCase())

  const { data, isLoading } = useSWR(!needsCreator ? `/api/v1/tokens/explore?${params}` : null, fetcher, {
    refreshInterval: 30_000,
    keepPreviousData: true,
  })
  const tokens = data?.data ?? []
  const total = data?.meta?.total ?? null

  return (
    <div className={styles.directory}>
      <header className={styles.directory__header}>
        {/* No heading here — PageTitle already puts "Tokens" in the fixed header */}
        <h2 className={styles.directory__title}>
          Explore
          {total !== null && <span className={styles.directory__count}>{formatCount(total)}</span>}
        </h2>

        <div className={styles.directory__actions}>
          <NetworkSelect />
          {/* Swap has no sidebar row of its own, so this is the way into the pools — a link rather
              than a button so middle-click and open-in-new-tab keep working */}
          <Link href="/swap" className={styles.directory__swap}>
            <ArrowsLeftRightIcon size={16} />
            Swap
          </Link>
          <button
            type="button"
            className={styles.directory__launch}
            onClick={() => createDialogRef.current?.open()}
            disabled={!launchAddress}
            title={launchAddress ? undefined : 'Token launches are not available on this network yet'}
          >
            <RocketLaunchIcon size={16} weight="fill" />
            Launch
          </button>
        </div>
      </header>

      <div className={styles.directory__toolbar}>
        <div className={styles.directory__sorts} role="tablist" aria-label="Sort tokens">
          {SORTS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={sort === entry.key}
              className={clsx(sort === entry.key && styles['directory__sort--active'])}
              onClick={() => setSort(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className={styles.directory__tools}>
          <label className={styles.directory__search}>
            <MagnifyingGlassIcon size={15} />
            <input
              type="search"
              value={query}
              placeholder="Search"
              aria-label="Search tokens"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          {/* Neither of these is a sort: they narrow the set rather than reorder it, so they stay
              toggles beside the search rather than more tabs that would mean something else */}
          <div className={styles.directory__filters}>
            {SOURCES.map((entry) => (
              <button
                key={entry.key}
                type="button"
                aria-pressed={source === entry.key}
                className={clsx(styles.directory__filter, source === entry.key && styles['directory__filter--active'])}
                onClick={() => setSource(entry.key)}
                title={entry.hint}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            aria-pressed={mineOnly}
            className={clsx(styles.directory__mine, mineOnly && styles['directory__mine--active'])}
            onClick={() => setMineOnly((value) => !value)}
          >
            Mine
          </button>

          <QuickBuyBar />

          <SegmentedControl
            options={VIEWS}
            value={view}
            onChange={setView}
            label="Layout"
            size="sm"
            iconOnly
            className={styles.directory__view}
          />
        </div>
      </div>

      {needsCreator && (
        <EmptyState icon={CoinIcon} align="center" size="lg">
          Connect your wallet to see the tokens you’ve launched.
        </EmptyState>
      )}

      {!needsCreator && !isLoading && tokens.length === 0 && (
        <EmptyState icon={query.trim() ? MagnifyingGlassIcon : CoinIcon} align="center" size="lg">
          {query.trim() ? 'No tokens match that search.' : 'Nothing here yet. Be the first to launch one.'}
        </EmptyState>
      )}

      {tokens.length > 0 && (view === 'list' ? <LaunchTable tokens={tokens} /> : <LaunchGrid tokens={tokens} />)}

      <CreateLaunchDialog ref={createDialogRef} fixedChainId={chainId} showSuccessStep />
    </div>
  )
}

export default LaunchDirectory

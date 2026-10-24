'use client'

import { Spinner, PageLoader } from '@/components/Loading'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
import clsx from 'clsx'
import { useConnection } from 'wagmi'
import { CONTRACTS, appChains } from '@/config/contracts'
import CreateMarketDialog from '@/components/CreateMarketDialog'
import DropsHero from '@/components/DropsHero'
import Profile from '@/components/Profile'
import HowPredictWorks from './HowPredictWorks'
import useStakeToken, { formatStake } from '@/hooks/useStakeToken'
import { marketStatus, parseJsonArray, toRelative } from '@/lib/predict'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { ChartLineUpIcon, MagnifyingGlassIcon, PlusIcon, ScalesIcon, StarIcon, UsersIcon } from '@phosphor-icons/react'
import styles from './PredictDirectory.module.scss'

const PAGE_SIZE = 25

const fetcher = async (url) => {
  const response = await fetch(url)
  const payload = await response.json()
  if (!response.ok || payload.success === false) throw new Error(payload.error || 'Could not load markets')
  return payload
}

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
  const [category, setCategory] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  // Debounce the query so SWR refetches settle instead of firing per keystroke
  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim()), 350)
    return () => clearTimeout(timeout)
  }, [searchInput])

  // Runtime-editable taxonomy from the market_categories table — drives the filter chips
  const { data: categoriesPayload } = useSWR('/api/v1/predict/categories', fetcher)
  const categories = categoriesPayload?.data ?? []

  // Chains where the predict contract is live — drives the network filter options
  const predictChains = useMemo(() => appChains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.predict), [])
  const chainName = (id) => appChains.find((chain) => chain.id === Number(id))?.name || `#${id}`

  const getKey = (pageIndex, previousPage) => {
    if (previousPage && !previousPage.nextPage) return null
    if (scope === 'mine' && !address) return null
    const params = new URLSearchParams({ scope, page: String(pageIndex + 1), limit: String(PAGE_SIZE) })
    if (networkId) params.set('networkId', networkId)
    if (category) params.set('category', category)
    if (scope === 'mine') params.set('participant', address)
    if (search) params.set('q', search)
    return `/api/v1/predict?${params}`
  }

  const {
    data: pages,
    isLoading,
    isValidating,
    error,
    size,
    setSize,
    mutate,
  } = useSWRInfinite(getKey, fetcher, {
    revalidateFirstPage: false,
  })

  const markets = useMemo(() => (pages ?? []).flatMap((page) => page?.data ?? []), [pages])
  const featured = useMemo(() => pages?.[0]?.meta?.featured ?? [], [pages])
  const showFeaturedStrip = scope === 'open' && !search && featured.length > 0
  // The API keeps featured rows in the main list too — drop them here so a market
  // never renders both in the strip and directly below it
  const listMarkets = useMemo(() => {
    if (!showFeaturedStrip) return markets
    const stripKeys = new Set(featured.map((market) => `${market.network_id}-${market.market_id}`))
    return markets.filter((market) => !stripKeys.has(`${market.network_id}-${market.market_id}`))
  }, [showFeaturedStrip, markets, featured])
  const hasMore = Boolean(pages?.[pages.length - 1]?.nextPage)

  // One card renderer feeds both the featured strip and the main list
  const renderCard = (market, inFeaturedStrip = false) => {
    const status = marketStatus(market)
    const outcomes = parseJsonArray(market.outcome_labels)
    const judges = [...new Set(parseJsonArray(market.judges).filter((judge) => typeof judge === 'string' && judge).map((judge) => judge.toLowerCase()))]
    const marketHref = `/predict/${market.network_id}/${market.market_id}`

    return (
      <div key={`${inFeaturedStrip ? 'featured-' : ''}${market.network_id}-${market.market_id}`} className={styles.directory__tile}>
        <Link
          href={marketHref}
          className={clsx(
            styles.directory__card,
            Boolean(Number(market.featured)) && !inFeaturedStrip ? styles['directory__card--featured'] : null
          )}
        >
          <div className={styles.directory__artwork}>
            {market.image_cid ? (
              <img src={resolveStorageImageUrl(market.image_cid, { width: 640 }) || market.image_cid} alt="" loading="lazy" />
            ) : (
              <ChartLineUpIcon size={48} weight="duotone" aria-hidden="true" />
            )}
            <span className={styles.directory__artworkNetwork}>{chainName(market.network_id)}</span>
          </div>
          <div className={styles.directory__cardTop}>
            <span className={clsx(styles.directory__badge, styles[`directory__badge--${status.key}`])}>{status.label}</span>
            {Boolean(Number(market.featured)) && <StarIcon size={14} weight="fill" className={styles.directory__star} />}
            {market.category_label && (
              <span className={styles.directory__categoryTag}>
                {market.category_emoji ? `${market.category_emoji} ` : ''}
                {market.category_label}
              </span>
            )}
          </div>

          <div className={styles.directory__cardBody}>
            <div className={styles.directory__cardMain}>
              <h3 className={styles.directory__title}>{market.title || 'Untitled market'}</h3>

              {outcomes.length > 0 && (
                <div className={styles.directory__outcomePreview}>
                  {outcomes.slice(0, 2).map((outcome, index) => (
                    <span key={index}>{typeof outcome === 'string' ? outcome : outcome.label || `Outcome ${index + 1}`}</span>
                  ))}
                  {outcomes.length > 2 && <small>+{outcomes.length - 2} more</small>}
                </div>
              )}

              <p className={styles.directory__meta}>
                <span>{market.display_name || shortWallet(market.wallet_address)}</span>
                {status.key === 'open' && <span>closes {toRelative(market.betting_deadline)}</span>}
                {status.key === 'upcoming' && <span>opens {toRelative(market.betting_opens_at)}</span>}
              </p>

              <p className={styles.directory__stats}>
                <MarketVolume market={market} />
                <span className={styles.directory__outcomes}>
                  <UsersIcon size={12} />
                  {market.bettor_count ?? 0} {Number(market.bettor_count) === 1 ? 'bettor' : 'bettors'}
                </span>
                <span className={styles.directory__outcomes}>{outcomes.length || market.outcome_count} outcomes</span>
                {status.key === 'resolved' && market.winning_outcome !== null && (
                  <span className={styles.directory__winner}>
                    <ScalesIcon size={12} />
                    {outcomes[Number(market.winning_outcome)]?.label || `Outcome #${Number(market.winning_outcome) + 1}`}
                  </span>
                )}
              </p>
            </div>
          </div>
        </Link>
        {judges.length > 0 && (
          <div className={styles.directory__judges} role="group" aria-label="Market judges">
            {judges.slice(0, 3).map((judge) => (
              <span key={judge} className={styles.directory__judge}>
                <Profile creator={judge} networkId={market.network_id} variant="imageOnly" size={26} fingerprint={false} linkBox hoverCard={false} />
              </span>
            ))}
            {judges.length > 3 && (
              <Link href={marketHref} className={styles.directory__moreJudges} aria-label={`View all ${judges.length} judges`}>
                +{judges.length - 3}
              </Link>
            )}
          </div>
        )}
      </div>
    )
  }

  const scopes = [
    { key: 'open', label: 'Open' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'closed', label: 'Awaiting' },
    { key: 'settled', label: 'Settled' },
    ...(address ? [{ key: 'mine', label: 'Mine' }] : []),
  ]

  const emptyCopy = {
    open: 'No open markets yet — be the first to start one.',
    upcoming: 'No upcoming markets scheduled.',
    closed: 'No markets are awaiting a result.',
    settled: 'No settled markets yet.',
    mine: "You haven't created, judged, or bet on any markets yet.",
  }

  return (
    <div className={styles.directory}>
      <DropsHero
        title="Create a market. Back your prediction."
        action={
          <button type="button" onClick={() => dialogRef.current?.open()}>
            <PlusIcon size={16} />
            New market
          </button>
        }
      >
        Explore outcome pools across networks. Judges resolve the result.
      </DropsHero>
      <div className={styles.directory__toolbar}>
        <div className={styles.directory__toggle} role="group" aria-label="Market scope">
          {scopes.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={scope === option.key}
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

        {/* Full-width basis pushes search + help onto their own row under the tabs */}
        <div className={styles.directory__searchRow}>
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
          <HowPredictWorks />
        </div>
      </div>

      {categories.length > 0 && (
        <div className={styles.directory__categories} role="group" aria-label="Filter by category">
          <button
            type="button"
            aria-pressed={category === ''}
            className={clsx(styles.directory__categoryChip, category === '' ? styles['directory__categoryChip--active'] : null)}
            onClick={() => setCategory('')}
          >
            All
          </button>
          {categories.map((entry) => (
            <button
              key={entry.slug}
              type="button"
              aria-pressed={category === entry.slug}
              className={clsx(styles.directory__categoryChip, category === entry.slug ? styles['directory__categoryChip--active'] : null)}
              // Chips toggle: clicking the active category clears the filter
              onClick={() => setCategory((current) => (current === entry.slug ? '' : entry.slug))}
            >
              {entry.emoji ? `${entry.emoji} ` : ''}
              {entry.label}
            </button>
          ))}
        </div>
      )}

      {isLoading && <PageLoader label="Loading markets" />}

      {error && (
        <div className={styles.directory__empty} role="alert">
          <p>Could not load markets. Please try again.</p>
          <button type="button" className={styles.directory__loadMore} onClick={() => mutate()}>Try again</button>
        </div>
      )}

      {!isLoading && !error && listMarkets.length === 0 && !showFeaturedStrip && (
        <div className={styles.directory__empty}>
          <ChartLineUpIcon size={32} />
          <p>{scope === 'mine' && !address ? 'Connect your wallet to see your markets.' : search ? `No markets match “${search}”.` : emptyCopy[scope]}</p>
        </div>
      )}

      {!isLoading && showFeaturedStrip && (
        <section className={styles.directory__featuredStrip} aria-label="Featured markets">
          <h2>
            <StarIcon size={14} weight="fill" />
            Featured
          </h2>
          <div className={styles.directory__grid}>{featured.map((market) => renderCard(market, true))}</div>
        </section>
      )}

      {!isLoading && listMarkets.length > 0 && (
        <section className={styles.directory__section} aria-label="Markets">
          <h2>{scopes.find((option) => option.key === scope)?.label || 'My'} markets</h2>
          <div className={styles.directory__grid}>{listMarkets.map((market) => renderCard(market))}</div>
        </section>
      )}

      {hasMore && (
        <button type="button" className={styles.directory__loadMore} onClick={() => setSize(size + 1)} disabled={isValidating}>
          {isValidating ? <><Spinner size={16} color="currentColor" /> Loading...</> : 'Load more'}
        </button>
      )}

      <CreateMarketDialog ref={dialogRef} onCreated={() => mutate()} />
    </div>
  )
}

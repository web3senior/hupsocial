'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useConnection, useReadContract } from 'wagmi'
import { erc20Abi, parseUnits } from 'viem'
import clsx from 'clsx'
import { FunnelIcon, MagnifyingGlassIcon, StorefrontIcon } from '@phosphor-icons/react'
import { getNftListings } from '@/lib/api'
import { appChains } from '@/config/contracts'
import { CONTRACTS } from '@/config/wagmi'
import { TIP_TOKENS } from '@/lib/tokens'
import { toast } from '@/components/NextToast'
import NativePopover from '@/components/ui/NativePopover'
import NftMarketCard from '@/components/NftMarketCard'
import SellNftModal from '@/components/SellNftModal'
import MarketHero from './MarketHero'
import styles from './NftMarketGrid.module.scss'

const PAGE_SIZE = 24

const STATUS_OPTIONS = [
  { value: 'default', label: 'Active + sold' },
  { value: 'active', label: 'Active' },
  { value: 'sold', label: 'Sold' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All statuses' },
]

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Lowest price' },
  { value: 'price_desc', label: 'Highest price' },
]

// Thresholds in basis points — the API takes 'any'/'none' or a minimum bps
const REFERRAL_OPTIONS = [
  { value: '', label: 'Any referral' },
  { value: 'any', label: 'Pays a referral' },
  { value: '500', label: '5% or more' },
  { value: '1000', label: '10% or more' },
  { value: 'none', label: 'No referral' },
]

const DEFAULT_FILTERS = {
  networkId: '',
  collection: '',
  status: 'default',
  standard: '',
  token: '',
  referral: '',
  minPrice: '',
  maxPrice: '',
  sort: 'newest',
}

const COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

// Only chains with HupTrade actually deployed are worth offering as a filter
const tradeChains = appChains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.trade)

const NETWORK_OPTIONS = [{ value: '', label: 'All networks' }, ...tradeChains.map((chain) => ({ value: String(chain.id), label: chain.name }))]

// Min/max price inputs are human units — resolving the selected token's decimals (native
// currency needs no read; an ERC20/LSP7 does, same selector both standards share) lets the
// filter convert them to the base-unit strings the API compares against.
function usePriceDecimals(networkId, token) {
  const numericChainId = networkId ? Number(networkId) : undefined
  const chainInfo = numericChainId ? appChains.find((c) => c.id === numericChainId) : null
  const isSpecificToken = Boolean(token && token !== 'native')

  const { data: tokenDecimals } = useReadContract({
    abi: erc20Abi,
    address: isSpecificToken ? token : undefined,
    functionName: 'decimals',
    chainId: numericChainId,
    query: { enabled: Boolean(isSpecificToken && numericChainId) },
  })

  if (isSpecificToken) return tokenDecimals ?? 18
  return chainInfo?.nativeCurrency?.decimals ?? 18
}

function buildApiFilters(filters, priceDecimals) {
  const api = {}
  if (filters.networkId) api.networkId = filters.networkId
  if (filters.collection) api.collection = filters.collection
  if (filters.status && filters.status !== 'default') api.status = filters.status
  if (filters.standard) api.standard = filters.standard
  if (filters.token) api.token = filters.token
  if (filters.referral) api.referral = filters.referral
  if (filters.sort && filters.sort !== 'newest') api.sort = filters.sort
  if (filters.minPrice) {
    try {
      api.minPrice = parseUnits(filters.minPrice, priceDecimals).toString()
    } catch {
      // Invalid number typed mid-edit — skip until it parses
    }
  }
  if (filters.maxPrice) {
    try {
      api.maxPrice = parseUnits(filters.maxPrice, priceDecimals).toString()
    } catch {
      // Invalid number typed mid-edit — skip until it parses
    }
  }
  return api
}

// Counts only what the popover still hides — network/status/referral/sort live in the
// always-visible quick row, so badging them would flag filters the user can already see
const hiddenFilterCount = (filters) =>
  [filters.collection, filters.standard, filters.token, filters.minPrice, filters.maxPrice].filter(Boolean).length

/**
 * Quick Select
 * One pill in the always-visible filter row. Carries no label of its own — the selected
 * option is the label — so it needs an aria-label to stay announceable, and highlights
 * itself whenever it holds something other than its default.
 */
function QuickSelect({ label, value, defaultValue, options, onChange }) {
  return (
    <select
      aria-label={label}
      className={clsx(styles.market__quickSelect, value !== defaultValue && styles['market__quickSelect--active'])}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/**
 * NFT Market Grid
 * Search + filter toolbar over a responsive grid of NftMarketCard tiles, replacing the old
 * post-feed rendering on the NFT Market page. Status/network/standard/payment-token/price/sort
 * all resolve server-side against the indexed nft_listings table (see GET /api/v1/nfts).
 * Name/seller search stays client-side over the currently loaded page — NFT metadata (name,
 * image) is resolved live per token, not indexed, so there's nothing to search server-side.
 */
export default function NftMarketGrid() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  const [items, setItems] = useState([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isFetchingMore, setIsFetchingMore] = useState(false)

  // Selling from here needs no post — the listing goes straight onchain and reaches this
  // grid through the indexer, so a fresh listing asks for a refetch of page 1
  const [isSelling, setIsSelling] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const { address, chain: walletChain } = useConnection()

  // Collection addresses aren't indexed by name anywhere — this Map fills in as each
  // visible card's live metadata resolves, so the "Collection" filter only ever offers
  // collections that actually showed up on screen. Cleared whenever the server-side
  // filters change (a fresh page 1), since a network switch invalidates prior entries.
  const [collectionOptions, setCollectionOptions] = useState(new Map())

  const handleCollectionResolved = useCallback((collectionAddress, collectionName) => {
    setCollectionOptions((prev) => (prev.has(collectionAddress) ? prev : new Map(prev).set(collectionAddress, collectionName)))
  }, [])

  const isFetchingRef = useRef(false)
  const hasMoreRef = useRef(false)

  const priceDecimals = usePriceDecimals(filters.networkId, filters.token)

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    let cancelled = false

    const fetchFirstPage = async () => {
      setIsLoading(true)
      // Keep the selected collection's label — selecting one triggers this very refetch,
      // and dropping its entry would leave the <select> pointing at a missing <option>.
      // The rest re-fills as this page's cards resolve their metadata.
      setCollectionOptions((prev) => {
        const label = filters.collection ? prev.get(filters.collection) : null
        return label ? new Map([[filters.collection, label]]) : new Map()
      })
      try {
        const res = await getNftListings(1, PAGE_SIZE, buildApiFilters(filters, priceDecimals))
        if (cancelled) return
        setItems(res.data || [])
        setHasMore(res.meta?.hasMore || false)
        setPage(1)
      } catch {
        if (!cancelled) {
          setItems([])
          setHasMore(false)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    fetchFirstPage()

    return () => {
      cancelled = true
    }
  }, [filters, priceDecimals, refreshKey])

  useEffect(() => {
    isFetchingRef.current = isFetchingMore
    hasMoreRef.current = hasMore
  }, [isFetchingMore, hasMore])

  const loadMore = useCallback(async () => {
    if (isFetchingRef.current || !hasMoreRef.current) return
    setIsFetchingMore(true)
    const nextPage = page + 1

    try {
      const res = await getNftListings(nextPage, PAGE_SIZE, buildApiFilters(filters, priceDecimals))
      setItems((prev) => [...prev, ...(res.data || [])])
      setHasMore(res.meta?.hasMore || false)
      setPage(nextPage)
    } catch {
      // A manual scroll/retry picks it back up — no need to surface an error for a load-more miss
    } finally {
      setIsFetchingMore(false)
    }
  }, [page, filters, priceDecimals])

  useEffect(() => {
    const onScroll = () => {
      const { scrollTop, clientHeight, scrollHeight } = document.documentElement
      if (scrollTop + clientHeight >= scrollHeight - 400 && hasMoreRef.current && !isFetchingRef.current) loadMore()
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [loadMore])

  // The sell modal opens on the network being browsed, else the wallet's own chain when
  // HupTrade lives there, else the first chain it's deployed on — and stays switchable inside
  const sellChainId =
    (filters.networkId ? Number(filters.networkId) : null) ??
    (walletChain && CONTRACTS[`chain${walletChain.id}`]?.trade ? walletChain.id : null) ??
    tradeChains[0]?.id ??
    null

  // A hero pick carries its own chain, so it sets the network filter too — the same
  // collection address can exist on several. It also hands over the name it resolved
  // onchain, otherwise the funnel's Collection <select> would point at a missing option
  // until a card below happened to resolve the same collection.
  const handleHeroSelect = useCallback(
    (heroNetworkId, collectionAddress, collectionName) => {
      if (!collectionAddress) {
        setFilters((f) => ({ ...f, collection: '' }))
        return
      }
      if (collectionName) handleCollectionResolved(collectionAddress, collectionName)
      // Payment token and price bounds are network-scoped, so a chain change drops them
      setFilters((f) => ({
        ...f,
        networkId: heroNetworkId,
        collection: collectionAddress,
        ...(heroNetworkId === f.networkId ? {} : { token: '', minPrice: '', maxPrice: '' }),
      }))
    },
    [handleCollectionResolved],
  )

  const handleSell = () => {
    if (!address) {
      toast('Connect your wallet to list an NFT', 'error')
      return
    }
    setIsSelling(true)
  }

  const tokensForNetwork = filters.networkId ? TIP_TOKENS[Number(filters.networkId)] ?? [] : []
  const collectionEntries = [...collectionOptions.entries()].sort((a, b) => COLLATOR.compare(a[1], b[1]))
  const searchLower = search.toLowerCase()
  const hiddenCount = hiddenFilterCount(filters)
  const isFiltered = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS)

  return (
    <div className={clsx('__container')} data-width="large">
      <div className={styles.market}>
        <MarketHero networkId={filters.networkId} activeCollection={filters.collection} onSelectCollection={handleHeroSelect} />

        <label className={clsx(styles.search, 'rounded-full')}>
          <MagnifyingGlassIcon size={18} aria-hidden="true" />
          <input
            type="search"
            className={styles.search__input}
            placeholder="Search NFT or seller..."
            aria-label="Search NFTs"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </label>

        {/* The filters users reach for constantly sit in the open; the narrower ones
            (collection, standard, payment token, price) stay behind the funnel. The pills
            scroll, the funnel does not — it must stay reachable at any width. */}
        <div className={styles.market__toolbar}>
          <div className={styles.market__quickFilters}>
            <QuickSelect
              label="Network"
              value={filters.networkId}
              defaultValue=""
              options={NETWORK_OPTIONS}
              onChange={(value) => setFilters((f) => ({ ...f, networkId: value, token: '', collection: '' }))}
            />
            <QuickSelect
              label="Status"
              value={filters.status}
              defaultValue="default"
              options={STATUS_OPTIONS}
              onChange={(value) => setFilters((f) => ({ ...f, status: value }))}
            />
            <QuickSelect
              label="Referral reward"
              value={filters.referral}
              defaultValue=""
              options={REFERRAL_OPTIONS}
              onChange={(value) => setFilters((f) => ({ ...f, referral: value }))}
            />
            <QuickSelect
              label="Sort"
              value={filters.sort}
              defaultValue="newest"
              options={SORT_OPTIONS}
              onChange={(value) => setFilters((f) => ({ ...f, sort: value }))}
            />
          </div>

          <NativePopover
            placement="bottom-end"
            className={styles.filtersPanel}
            trigger={
              <button type="button" className={styles.market__filterButton} aria-label="More filters">
                <FunnelIcon size={16} />
                {hiddenCount > 0 && <span className={styles.market__filterBadge}>{hiddenCount}</span>}
              </button>
            }
          >
            {() => (
              <div className={styles.filtersPanel__body}>
                <div className={styles.filtersPanel__field}>
                  <label htmlFor="nftFilterCollection">Collection</label>
                  <select
                    id="nftFilterCollection"
                    value={filters.collection}
                    disabled={collectionEntries.length === 0}
                    onChange={(e) => setFilters((f) => ({ ...f, collection: e.target.value }))}
                  >
                    <option value="">All collections</option>
                    {collectionEntries.map(([address, name]) => (
                      <option key={address} value={address}>
                        {name}
                      </option>
                    ))}
                  </select>
                  {collectionEntries.length === 0 && (
                    <small className={styles.filtersPanel__hint}>Collections appear as listings load</small>
                  )}
                </div>

                <div className={styles.filtersPanel__field}>
                  <label htmlFor="nftFilterStandard">NFT standard</label>
                  <select id="nftFilterStandard" value={filters.standard} onChange={(e) => setFilters((f) => ({ ...f, standard: e.target.value }))}>
                    <option value="">Any</option>
                    <option value="erc721">ERC721</option>
                    <option value="lsp8">LSP8</option>
                  </select>
                </div>

                <div className={styles.filtersPanel__field}>
                  <label htmlFor="nftFilterToken">Payment token</label>
                  <select
                    id="nftFilterToken"
                    value={filters.token}
                    disabled={!filters.networkId}
                    onChange={(e) => setFilters((f) => ({ ...f, token: e.target.value }))}
                  >
                    <option value="">Any</option>
                    <option value="native">Native currency</option>
                    {tokensForNetwork.map((t) => (
                      <option key={t.address} value={t.address}>
                        {t.symbol}
                      </option>
                    ))}
                  </select>
                  {!filters.networkId && <small className={styles.filtersPanel__hint}>Pick a network first</small>}
                </div>

                <div className={styles.filtersPanel__field}>
                  <label>Price range</label>
                  <div className={styles.filtersPanel__range}>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      placeholder="Min"
                      value={filters.minPrice}
                      disabled={!filters.networkId}
                      onChange={(e) => setFilters((f) => ({ ...f, minPrice: e.target.value }))}
                    />
                    <span>–</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      placeholder="Max"
                      value={filters.maxPrice}
                      disabled={!filters.networkId}
                      onChange={(e) => setFilters((f) => ({ ...f, maxPrice: e.target.value }))}
                    />
                  </div>
                  {!filters.networkId && <small className={styles.filtersPanel__hint}>Pick a network first</small>}
                </div>

                {isFiltered && (
                  <button type="button" className={styles.filtersPanel__reset} onClick={() => setFilters(DEFAULT_FILTERS)}>
                    Reset filters
                  </button>
                )}
              </div>
            )}
          </NativePopover>

          {/* Listing needs no post — this opens the same HupTrade flow the composer uses */}
          <button type="button" className={styles.market__sellButton} aria-label="Sell NFT" onClick={handleSell}>
            <StorefrontIcon size={16} weight="fill" />
            <span>Sell NFT</span>
          </button>
        </div>

        {isLoading ? (
          <div className={styles.market__grid}>
            {/* 12 divides by both column counts, so the skeleton never ends on an orphan row */}
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className={styles.market__skeletonTile} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className={styles.market__empty}>No listings match these filters.</p>
        ) : (
          <div className={styles.market__grid}>
            {items.map((listing) => {
              const sellerMatches = Boolean(
                searchLower &&
                  ((listing.display_name && listing.display_name.toLowerCase().includes(searchLower)) ||
                    listing.wallet_address?.toLowerCase().includes(searchLower)),
              )
              return (
                <NftMarketCard
                  key={`${listing.network_id}-${listing.listing_id}`}
                  listing={listing}
                  nameFilter={searchLower && !sellerMatches ? searchLower : undefined}
                  onCollectionResolved={handleCollectionResolved}
                />
              )
            })}
          </div>
        )}

        {hasMore && !isLoading && (
          <div className={styles.market__loadMoreWrap}>
            <button type="button" className={styles.market__loadMore} onClick={loadMore} disabled={isFetchingMore}>
              {isFetchingMore ? 'Loading...' : 'Load more'}
            </button>
          </div>
        )}

        {/* No onAttached — the modal lists standalone and the grid just refetches after */}
        {isSelling && (
          <SellNftModal chainId={sellChainId} onListed={() => setRefreshKey((key) => key + 1)} onClose={() => setIsSelling(false)} />
        )}
      </div>
    </div>
  )
}

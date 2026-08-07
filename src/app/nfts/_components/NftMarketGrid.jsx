'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useConnection, useReadContract } from 'wagmi'
import { erc20Abi, parseUnits } from 'viem'
import clsx from 'clsx'
import { ArrowsClockwiseIcon, FunnelIcon, MagnifyingGlassIcon, StorefrontIcon, XIcon } from '@phosphor-icons/react'
import { getNftListings, getNftPaymentTokens, getNftSellers } from '@/lib/api'
import { handleBrokenImage } from '@/lib/utils'
import { useProfile } from '@/hooks/useProfile'
import useCollectionMetadataRefresh, { describeCollectionRefresh } from '@/hooks/useCollectionMetadataRefresh'
import { appChains } from '@/config/contracts'
import { CONTRACTS } from '@/config/wagmi'
import { toast } from '@/components/NextToast'
import NativePopover from '@/components/ui/NativePopover'
import Tooltip from '@/components/ui/Tooltip'
import NftMarketCard from '@/components/NftMarketCard'
import SellNftModal from '@/components/SellNftModal'
import MarketHero from './MarketHero'
import styles from './NftMarketGrid.module.scss'

const PAGE_SIZE = 24

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'active_sold', label: 'Active + sold' },
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
  status: 'active',
  standard: '',
  token: '',
  referral: '',
  seller: '',
  minPrice: '',
  maxPrice: '',
  sort: 'newest',
}

const COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

const FILTER_KEYS = Object.keys(DEFAULT_FILTERS)

const isOption = (options, value) => options.some((o) => o.value === value)

/**
 * The URL query string is the source of truth for the grid's filters — that's what lets the
 * browser's back button return from a listing detail into the exact collection view the user
 * left, instead of a reset market page. Enum-ish params are checked against their option
 * lists so a hand-edited URL degrades to the default rather than a confusing empty grid;
 * addresses pass through (lowercased where the grid compares them lowercased).
 */
function filtersFromParams(params, networkOptions) {
  const filters = { ...DEFAULT_FILTERS }
  for (const key of FILTER_KEYS) {
    const value = params.get(key)
    if (value) filters[key] = value
  }
  if (!isOption(networkOptions, filters.networkId)) filters.networkId = DEFAULT_FILTERS.networkId
  if (!isOption(STATUS_OPTIONS, filters.status)) filters.status = DEFAULT_FILTERS.status
  if (!isOption(SORT_OPTIONS, filters.sort)) filters.sort = DEFAULT_FILTERS.sort
  if (!isOption(REFERRAL_OPTIONS, filters.referral)) filters.referral = DEFAULT_FILTERS.referral
  if (filters.standard && !['erc721', 'lsp8'].includes(filters.standard)) filters.standard = DEFAULT_FILTERS.standard
  filters.collection = filters.collection.toLowerCase()
  return filters
}

function buildQueryString(filters, search) {
  const params = new URLSearchParams()
  for (const key of FILTER_KEYS) {
    if (filters[key] !== DEFAULT_FILTERS[key]) params.set(key, filters[key])
  }
  if (search) params.set('q', search)
  return params.toString()
}

/**
 * Back/forward cache for the grid, keyed by the query string. The URL work above restores
 * WHICH view the user was in; this restores what was on screen — the loaded pages and the
 * scroll offset — so returning from a listing detail doesn't reset to a page-1 skeleton
 * with the browser's scroll restore landing in the wrong place. Module scope survives
 * client-side navigation and empties on a full reload, which is exactly a bfcache's
 * lifetime. Snapshots are only re-applied to a query string they were captured under.
 */
const GRID_CACHE_LIMIT = 20
const gridCache = new Map()

function writeGridCache(key, snapshot) {
  gridCache.delete(key)
  gridCache.set(key, snapshot)
  if (gridCache.size > GRID_CACHE_LIMIT) gridCache.delete(gridCache.keys().next().value)
}

/**
 * Scroll is only re-applied for history traversals — a nav-link push must land at the top.
 * Telling the two apart is ordering-sensitive: browser-chrome back fires popstate BEFORE
 * the new page commits, while router.back() (the in-page Back button) commits first and
 * its popstate lands a few ms later. So the restore effect below handles both: it applies
 * directly when a popstate just fired, otherwise it arms pendingScrollRestore and lets the
 * imminent popstate pull the trigger. A push never gets a popstate — the armed restore
 * disarms on a short timer (or unmount) and the page stays wherever the router put it.
 */
let lastPopstateAt = Number.NEGATIVE_INFINITY
let pendingScrollRestore = null
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    lastPopstateAt = performance.now()
    if (pendingScrollRestore != null) {
      window.scrollTo({ top: pendingScrollRestore, behavior: 'instant' })
      pendingScrollRestore = null
    }
  })
}


// Only chains with HupTrade actually deployed are worth offering as a filter
const tradeChains = appChains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.trade)

const NETWORK_OPTIONS = [{ value: '', label: 'All networks' }, ...tradeChains.map((chain) => ({ value: String(chain.id), label: chain.name }))]

const shortAddress = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`

/**
 * Turn the payment-token rows the API returns into <select> options.
 *
 * The API answers per (chain, token) because symbol and decimals are indexed per chain, but the
 * filter itself matches on the address alone — so one token listed on several chains collapses
 * into a single option, and every chain's native currency collapses into the API's shared
 * 'native' keyword. Tokens the indexer hasn't named yet fall back to their address, and the
 * count keeps the currencies most of the market is priced in at the top.
 */
function buildTokenOptions(rows) {
  const options = new Map()

  for (const row of rows) {
    const value = row.is_native ? 'native' : String(row.token).toLowerCase()
    const chain = appChains.find((c) => c.id === Number(row.network_id))
    const label = row.is_native
      ? row.symbol || chain?.nativeCurrency?.symbol || 'Native currency'
      : row.symbol || shortAddress(String(row.token))
    const existing = options.get(value)

    if (existing) {
      existing.count += row.listing_count || 0
      // Native means a different currency on every chain (LYX here, MON there) — with no
      // network picked there's no one symbol to show, so the generic name stands in
      if (existing.label !== label) existing.label = row.is_native ? 'Native currency' : existing.label
      existing.decimals = existing.decimals ?? row.decimals ?? null
      continue
    }

    options.set(value, { value, label, decimals: row.decimals ?? null, count: row.listing_count || 0 })
  }

  return [...options.values()].sort((a, b) => b.count - a.count || COLLATOR.compare(a.label, b.label))
}

// Min/max price inputs are human units — resolving the selected token's decimals lets the filter
// convert them to the base-unit strings the API compares against. store_tokens already carries
// decimals for anything the indexer has named, so the onchain read (same `decimals()` selector
// ERC20 and LSP7 share) is only a fallback for tokens it hasn't.
function usePriceDecimals(networkId, token, indexedDecimals) {
  const numericChainId = networkId ? Number(networkId) : undefined
  const chainInfo = numericChainId ? appChains.find((c) => c.id === numericChainId) : null
  const isSpecificToken = Boolean(token && token !== 'native')
  const needsRead = isSpecificToken && indexedDecimals == null

  const { data: tokenDecimals } = useReadContract({
    abi: erc20Abi,
    address: needsRead ? token : undefined,
    functionName: 'decimals',
    chainId: numericChainId,
    query: { enabled: Boolean(needsRead && numericChainId) },
  })

  if (isSpecificToken) return indexedDecimals ?? tokenDecimals ?? 18
  return chainInfo?.nativeCurrency?.decimals ?? 18
}

function buildApiFilters(filters, priceDecimals) {
  const api = {}
  if (filters.networkId) api.networkId = filters.networkId
  if (filters.collection) api.collection = filters.collection
  if (filters.status && filters.status !== 'active') api.status = filters.status
  if (filters.standard) api.standard = filters.standard
  if (filters.token) api.token = filters.token
  if (filters.referral) api.referral = filters.referral
  if (filters.seller) api.seller = filters.seller
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
  [filters.collection, filters.standard, filters.token, filters.seller, filters.minPrice, filters.maxPrice].filter(Boolean).length

const sellerLabel = (user) => user.display_name || shortAddress(user.wallet_address)

// Suggestion rows and the selected chip share this. The image resolves through the shared
// useProfile hook (SWR-cached, Universal Profile first, DB fallback, default pfp for plain
// EOAs) — the sellers API's own profile_image is DB/UP-only and left EOA sellers pointing
// at a broken image. An initial stands in while the profile is still resolving.
function SellerAvatar({ user }) {
  const { profile } = useProfile(user.wallet_address)

  if (!profile?.profileImage) {
    return (
      <span className={clsx(styles.filtersPanel__sellerAvatar, styles['filtersPanel__sellerAvatar--fallback'])} aria-hidden="true">
        {sellerLabel(user).slice(0, 1).toUpperCase()}
      </span>
    )
  }
  return <img className={styles.filtersPanel__sellerAvatar} src={profile.profileImage} alt="" loading="lazy" onError={handleBrokenImage} />
}

/**
 * Quick Select
 * One pill in the always-visible filter row. Carries no label of its own — the selected
 * option is the label — so it needs an aria-label to stay announceable, and highlights
 * itself whenever it holds something other than its default. The tooltip is where the
 * label went: what the pill filters on, in a sentence, without a word of chrome in the row.
 */
function QuickSelect({ label, value, defaultValue, options, onChange, tooltip }) {
  return (
    <Tooltip content={tooltip}>
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
    </Tooltip>
  )
}

/**
 * NFT Market Grid
 * Search + filter toolbar over a responsive grid of NftMarketCard tiles, replacing the old
 * post-feed rendering on the NFT Market page. Status/network/standard/payment-token/seller/
 * price/sort all resolve server-side against the indexed nft_listings table (see GET /api/v1/nfts).
 * Name/seller search stays client-side over the currently loaded page — NFT metadata (name,
 * image) is resolved live per token, not indexed, so there's nothing to search server-side.
 */
export default function NftMarketGrid() {
  const searchParams = useSearchParams()

  // Filters live in the URL, not component state — coming back from a listing detail
  // remounts this grid, and the query string is the only thing that survives the trip
  const filters = useMemo(() => filtersFromParams(searchParams, NETWORK_OPTIONS), [searchParams])
  const filtersRef = useRef(filters)
  useEffect(() => {
    filtersRef.current = filters
  }, [filters])

  const [searchInput, setSearchInput] = useState(() => searchParams.get('q') || '')
  const [search, setSearch] = useState(() => (searchParams.get('q') || '').trim())
  const searchRef = useRef(search)

  /**
   * Drop-in replacement for the old useState setter — same updater-function call sites,
   * but the result is written to the URL and flows back in through useSearchParams.
   * Picking or clearing a collection is a drill-in/out navigation, so it PUSHES a history
   * entry (back steps detail → collection → market); every other tweak — status, sort,
   * price, seller — REPLACES in place so filter fiddling doesn't bloat history.
   */
  const setFilters = useCallback((updater) => {
    const current = filtersRef.current
    const next = typeof updater === 'function' ? updater(current) : updater
    filtersRef.current = next
    const query = buildQueryString(next, searchRef.current)
    const url = query ? `${window.location.pathname}?${query}` : window.location.pathname
    if (next.collection !== current.collection) window.history.pushState(null, '', url)
    else window.history.replaceState(null, '', url)
  }, [])

  // Seller is a typeahead: typing only queries suggestions (name or wallet prefix, served
  // from wallets that actually have listings) — the grid itself refetches only once a user
  // is picked, which puts their exact address into filters.seller
  const [sellerQuery, setSellerQuery] = useState('')
  const [sellerOptions, setSellerOptions] = useState([])
  const [isLoadingSellers, setIsLoadingSellers] = useState(false)
  const [isSellerFocused, setIsSellerFocused] = useState(false)
  // Re-seeded from the URL so the chip survives the detail-page round trip — the avatar
  // and display name resolve from the address alone (useProfile / shortAddress fallback)
  const [selectedSeller, setSelectedSeller] = useState(() => {
    const seller = searchParams.get('seller')
    return seller ? { wallet_address: seller } : null
  })

  // The bfcache key comes from Next, not window.location — during a router.back() commit
  // the address bar still shows the page being left, but searchParams already carry the
  // target route's query, and they track this page's own pushState/replaceState updates too
  const cacheKey = searchParams.toString()
  const cacheKeyRef = useRef(cacheKey)
  useEffect(() => {
    cacheKeyRef.current = cacheKey
  }, [cacheKey])

  // Snapshot of this exact view from the bfcache, if the user has been here this session.
  // Only client-side navigations can hit (a full load starts with an empty module cache),
  // so seeding initial state from it can never diverge from server-rendered HTML.
  const [restoredSnapshot] = useState(() => (typeof window === 'undefined' ? null : gridCache.get(searchParams.toString()) || null))

  const [items, setItems] = useState(() => restoredSnapshot?.items || [])
  const [page, setPage] = useState(() => restoredSnapshot?.page || 1)
  const [hasMore, setHasMore] = useState(() => restoredSnapshot?.hasMore || false)
  const [isLoading, setIsLoading] = useState(() => !restoredSnapshot)
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
  const [collectionOptions, setCollectionOptions] = useState(() => restoredSnapshot?.collectionOptions || new Map())

  const handleCollectionResolved = useCallback((collectionAddress, collectionName) => {
    setCollectionOptions((prev) => (prev.has(collectionAddress) ? prev : new Map(prev).set(collectionAddress, collectionName)))
  }, [])

  // Payment tokens come from the listings themselves, not a curated list — anything a seller
  // priced in shows up here. Refetched per network, and after a fresh listing, which may have
  // introduced a currency nothing else on the market uses yet.
  const [tokenOptions, setTokenOptions] = useState([])
  const [isLoadingTokens, setIsLoadingTokens] = useState(true)

  const isFetchingRef = useRef(false)
  const hasMoreRef = useRef(false)

  const selectedToken = tokenOptions.find((o) => o.value === filters.token)
  const priceDecimals = usePriceDecimals(filters.networkId, filters.token, selectedToken?.decimals)

  // One entry per distinct fetch input — lets the fetch effect below no-op when its result
  // is already on screen. Seeded with the mount inputs on a restore, so the initial run
  // doesn't refetch page 1 and throw away every loaded page beyond the first (idempotent
  // under StrictMode's replayed mount, unlike a consumable boolean).
  const lastFetchKeyRef = useRef(restoredSnapshot ? JSON.stringify([filters, priceDecimals, 0]) : null)

  // Snap back to where the user was. The restored rows are already in this render's DOM
  // with their final height (fixed aspect-ratio tiles), and 'instant' overrides the app's
  // global scroll-behavior: smooth — an animated restore is itself the "scroll shows the
  // wrong place" drift this cache exists to fix. See the pendingScrollRestore block above
  // for why a traversal is detected two different ways.
  useLayoutEffect(() => {
    if (!restoredSnapshot) return
    if (performance.now() - lastPopstateAt < 1000) {
      // Browser-chrome back: its popstate already fired, restore right now, pre-paint
      window.scrollTo({ top: restoredSnapshot.scrollY, behavior: 'instant' })
      return
    }
    // router.back(): the matching popstate lands a few ms after this commit — arm it.
    // If none comes (this was a plain push), disarm and stay at the top.
    pendingScrollRestore = restoredSnapshot.scrollY
    const timer = setTimeout(() => {
      pendingScrollRestore = null
    }, 500)
    return () => {
      clearTimeout(timer)
      pendingScrollRestore = null
    }
  }, [restoredSnapshot])

  // Snapshot whatever the grid last settled on; the scroll listener keeps scrollY current
  useEffect(() => {
    if (isLoading) return
    writeGridCache(cacheKey, { items, page, hasMore, collectionOptions, scrollY: window.scrollY })
  }, [items, page, hasMore, collectionOptions, isLoading, cacheKey])

  useEffect(() => {
    let cancelled = false

    const fetchTokens = async () => {
      setIsLoadingTokens(true)
      try {
        const res = await getNftPaymentTokens(filters.networkId)
        if (!cancelled) setTokenOptions(buildTokenOptions(res.data || []))
      } catch {
        if (!cancelled) setTokenOptions([])
      } finally {
        if (!cancelled) setIsLoadingTokens(false)
      }
    }
    fetchTokens()

    return () => {
      cancelled = true
    }
  }, [filters.networkId, refreshKey])

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  // q rides along in the URL so the name search also survives the detail round trip.
  // Always a replace — typing is not a navigation step.
  useEffect(() => {
    searchRef.current = search
    const query = buildQueryString(filtersRef.current, search)
    if (query === window.location.search.replace(/^\?/, '')) return
    window.history.replaceState(null, '', query ? `${window.location.pathname}?${query}` : window.location.pathname)
  }, [search])

  // An empty query still fetches — it returns the market's most active sellers, so the
  // list has something to offer the moment the field is focused. Scoped to the browsed
  // network so the listing counts match what the grid can actually show.
  useEffect(() => {
    if (selectedSeller) return
    let cancelled = false

    const timer = setTimeout(async () => {
      setIsLoadingSellers(true)
      try {
        const res = await getNftSellers(sellerQuery.trim(), filters.networkId)
        if (!cancelled) setSellerOptions(res.data || [])
      } catch {
        if (!cancelled) setSellerOptions([])
      } finally {
        if (!cancelled) setIsLoadingSellers(false)
      }
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [sellerQuery, filters.networkId, selectedSeller, refreshKey])

  const handleSellerSelect = useCallback(
    (user) => {
      setSelectedSeller(user)
      setSellerQuery('')
      setFilters((f) => ({ ...f, seller: user.wallet_address }))
    },
    [setFilters],
  )

  const handleSellerClear = useCallback(() => {
    setSelectedSeller(null)
    setFilters((f) => ({ ...f, seller: '' }))
  }, [setFilters])

  useEffect(() => {
    // Same inputs as the result already on screen (a restored snapshot, or StrictMode
    // replaying the mount) — refetching would truncate the list back to page 1
    const fetchKey = JSON.stringify([filters, priceDecimals, refreshKey])
    if (fetchKey === lastFetchKeyRef.current) return
    lastFetchKeyRef.current = fetchKey

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
      // This run's result never landed (cancelled) — forget its key so the next run,
      // even with identical inputs, fetches instead of skipping
      lastFetchKeyRef.current = null
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
      const cached = gridCache.get(cacheKeyRef.current)
      if (cached) cached.scrollY = scrollTop
      if (scrollTop + clientHeight >= scrollHeight - 400 && hasMoreRef.current && !isFetchingRef.current) loadMore()
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [loadMore])

  // Drilling into a collection is the one place a whole-collection metadata refresh makes
  // sense — every tile on screen belongs to it. The funnel's Collection <select> offers a bare
  // address with no network attached, so when the network filter is empty the chain is taken
  // from the loaded rows themselves; the same collection can exist on several.
  const activeCollectionChainId = filters.collection
    ? Number(filters.networkId) || Number(items.find((item) => item.collection?.toLowerCase() === filters.collection)?.network_id) || null
    : null

  const collectionRefresh = useCollectionMetadataRefresh({ chainId: activeCollectionChainId, collection: filters.collection })

  const handleRefreshCollection = async () => {
    try {
      const result = await collectionRefresh.refresh()
      if (!result) return
      toast(...describeCollectionRefresh(result))
    } catch (error) {
      toast(error.message || 'Could not refresh the collection', 'error')
    }
  }

  // The sell modal opens on the network being browsed, else the wallet's own chain when
  // HupTrade lives there, else the first chain it's deployed on — and stays switchable inside
  const sellChainId =
    (filters.networkId ? Number(filters.networkId) : null) ??
    (walletChain && CONTRACTS[`chain${walletChain.id}`]?.trade ? walletChain.id : null) ??
    tradeChains[0]?.id ??
    null

  const handleSell = () => {
    if (!address) {
      toast('Connect your wallet to list an NFT', 'error')
      return
    }
    setIsSelling(true)
  }

  // A price range only means something once its unit is pinned down: a chain fixes the native
  // currency's decimals, and a specific token carries its own from the index
  const canFilterPrice = Boolean(filters.networkId) || Boolean(selectedToken && selectedToken.value !== 'native' && selectedToken.decimals != null)
  const collectionEntries = [...collectionOptions.entries()].sort((a, b) => COLLATOR.compare(a[1], b[1]))
  const searchLower = search.toLowerCase()
  const hiddenCount = hiddenFilterCount(filters)
  const isFiltered = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS)

  return (
    <div className={clsx('__container')} data-width="large">
      <div className={styles.market}>
        <MarketHero networkId={filters.networkId} />

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
              tooltip="Show only listings on one chain. Collections and payment tokens are chain-specific, so switching networks clears both."
              value={filters.networkId}
              defaultValue=""
              options={NETWORK_OPTIONS}
              onChange={(value) => setFilters((f) => ({ ...f, networkId: value, token: '', collection: '' }))}
            />
            <QuickSelect
              label="Status"
              tooltip="Where a listing stands onchain. Active is what you can buy right now — widen it to see what already sold or was cancelled."
              value={filters.status}
              defaultValue="active"
              options={STATUS_OPTIONS}
              onChange={(value) => setFilters((f) => ({ ...f, status: value }))}
            />
            <QuickSelect
              label="Referral reward"
              tooltip="The cut of the sale a listing pays whoever brings the buyer. Filter for listings that pay at least a set share."
              value={filters.referral}
              defaultValue=""
              options={REFERRAL_OPTIONS}
              onChange={(value) => setFilters((f) => ({ ...f, referral: value }))}
            />
            <QuickSelect
              label="Sort"
              tooltip="Order the grid — newest listings first, or by price. Price order only lines up across listings priced in the same token."
              value={filters.sort}
              defaultValue="newest"
              options={SORT_OPTIONS}
              onChange={(value) => setFilters((f) => ({ ...f, sort: value }))}
            />
          </div>

          {/* Only while a collection is the view — a sweep of "everything on the market" is
              not something a button should be able to start */}
          {activeCollectionChainId && (
            <button
              type="button"
              className={styles.market__refreshButton}
              aria-label="Refresh this collection's metadata"
              title="Re-read every NFT in this collection from the blockchain"
              onClick={handleRefreshCollection}
              disabled={collectionRefresh.isRefreshing}
            >
              <ArrowsClockwiseIcon size={16} className={clsx(collectionRefresh.isRefreshing && styles['market__refreshButton--spinning'])} />
            </button>
          )}

          <NativePopover
            placement="bottom-end"
            className={styles.filtersPanel}
            trigger={
              // Tooltip passes the popover's trigger props through to the button, so the
              // funnel still toggles the panel while describing what's behind it
              <Tooltip
                placement="top-end"
                content={
                  hiddenCount > 0
                    ? `${hiddenCount} more ${hiddenCount === 1 ? 'filter is' : 'filters are'} set here — collection, seller, NFT standard, payment token and price range.`
                    : 'The narrower filters: collection, seller, NFT standard, payment token and price range.'
                }
              >
                <button type="button" className={styles.market__filterButton} aria-label="More filters">
                  <FunnelIcon size={16} />
                  {hiddenCount > 0 && <span className={styles.market__filterBadge}>{hiddenCount}</span>}
                </button>
              </Tooltip>
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

                <div className={clsx(styles.filtersPanel__field, styles['filtersPanel__field--seller'])}>
                  <label htmlFor="nftFilterSeller">Seller</label>
                  {selectedSeller ? (
                    <div className={styles.filtersPanel__sellerPick}>
                      <SellerAvatar user={selectedSeller} />
                      <span className={styles.filtersPanel__sellerName}>{sellerLabel(selectedSeller)}</span>
                      <button
                        type="button"
                        className={styles.filtersPanel__sellerClear}
                        aria-label="Clear seller filter"
                        onClick={handleSellerClear}
                      >
                        <XIcon size={14} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <input
                        id="nftFilterSeller"
                        type="text"
                        autoComplete="off"
                        placeholder="Name or wallet address"
                        value={sellerQuery}
                        onChange={(e) => setSellerQuery(e.target.value)}
                        onFocus={() => setIsSellerFocused(true)}
                        onBlur={() => setIsSellerFocused(false)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && sellerOptions.length > 0) {
                            e.preventDefault()
                            handleSellerSelect(sellerOptions[0])
                          }
                        }}
                      />
                      {/* Overlays the fields below instead of pushing them down. The filters
                          panel is already in the top layer, so absolute positioning inside it
                          needs no nested popover. preventDefault on mousedown keeps the input
                          focused while clicking inside — otherwise blur hides the dropdown
                          before the option's click can land. */}
                      {(isSellerFocused || sellerQuery.trim()) && (
                        <div className={styles.filtersPanel__sellerDropdown} onMouseDown={(e) => e.preventDefault()}>
                          {sellerOptions.length > 0 ? (
                            <ul className={styles.filtersPanel__sellerList} aria-label="Matching sellers">
                              {sellerOptions.map((user) => (
                                <li key={user.wallet_address}>
                                  <button type="button" className={styles.filtersPanel__sellerOption} onClick={() => handleSellerSelect(user)}>
                                    <SellerAvatar user={user} />
                                    <span className={styles.filtersPanel__sellerName}>{sellerLabel(user)}</span>
                                    <small>{user.listing_count}</small>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <small className={styles.filtersPanel__hint}>
                              {isLoadingSellers ? 'Searching sellers...' : 'No sellers match'}
                            </small>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className={styles.filtersPanel__field}>
                  <label htmlFor="nftFilterStandard">NFT standard</label>
                  <select id="nftFilterStandard" value={filters.standard} onChange={(e) => setFilters((f) => ({ ...f, standard: e.target.value }))}>
                    <option value="">Any</option>
                    <option value="erc721">ERC721</option>
                    <option value="lsp8" title="LSP8">
                      NFT 2.0
                    </option>
                  </select>
                </div>

                <div className={styles.filtersPanel__field}>
                  <label htmlFor="nftFilterToken">Payment token</label>
                  <select
                    id="nftFilterToken"
                    value={filters.token}
                    disabled={tokenOptions.length === 0}
                    onChange={(e) => setFilters((f) => ({ ...f, token: e.target.value }))}
                  >
                    <option value="">Any</option>
                    {tokenOptions.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label} ({t.count})
                      </option>
                    ))}
                  </select>
                  {tokenOptions.length === 0 && (
                    <small className={styles.filtersPanel__hint}>
                      {isLoadingTokens ? 'Loading currencies...' : 'No listings on this network yet'}
                    </small>
                  )}
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
                      disabled={!canFilterPrice}
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
                      disabled={!canFilterPrice}
                      onChange={(e) => setFilters((f) => ({ ...f, maxPrice: e.target.value }))}
                    />
                  </div>
                  {!canFilterPrice && <small className={styles.filtersPanel__hint}>Pick a network or payment token first</small>}
                </div>

                {isFiltered && (
                  <button
                    type="button"
                    className={styles.filtersPanel__reset}
                    onClick={() => {
                      setSellerQuery('')
                      setSelectedSeller(null)
                      setFilters(DEFAULT_FILTERS)
                    }}
                  >
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

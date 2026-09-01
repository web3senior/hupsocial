'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { XIcon } from '@phosphor-icons/react'
import { getNftListings } from '@/lib/api'
import { appChains } from '@/config/contracts'
import { networkColorStyle } from '@/lib/networkColors'
import useCollectionInfo from '@/hooks/useCollectionInfo'
import useCollectionMetadataRefresh, { describeCollectionRefresh } from '@/hooks/useCollectionMetadataRefresh'
import useCollectionStats from '@/hooks/useCollectionStats'
import useCollectionFloor from '@/hooks/useCollectionFloor'
import useCollectionRarity from '@/hooks/useCollectionRarity'
import useCollectionTopOffers from '@/hooks/useCollectionTopOffers'
import useCollectionTraits from '@/hooks/useCollectionTraits'
import useGridLayout from '@/hooks/useGridLayout'
import useStoredChoice from '@/hooks/useStoredChoice'
import { toast } from '@/components/NextToast'
import PageTitle from '@/components/PageTitle'
import NftMarketCard from '@/components/NftMarketCard'
import LayoutToggle from '@/components/ui/LayoutToggle'
import SegmentedControl from '@/components/ui/SegmentedControl'
import CollectionBrowser from './CollectionBrowser'
import CollectionGallery from './CollectionGallery'
import CollectionHeader from './CollectionHeader'
import CollectionTable from './CollectionTable'
import FloorChart from './FloorChart'
import OwnedTokens from './OwnedTokens'
import TraitFilter from './TraitFilter'
import styles from './CollectionView.module.scss'

const PAGE_SIZE = 24

// The first three slice this app's listings — 'all' is everything still on the market, since
// cancelled listings are never served; 'collection' leaves the order book entirely and browses
// the collection's tokens themselves — see CollectionBrowser; 'walk' hangs the live listings
// in a room the reader walks through — see CollectionGallery
const STATUS_TABS = [
  { value: 'active', label: 'For sale' },
  { value: 'sold', label: 'Sold' },
  { value: 'all', label: 'Everything' },
  { value: 'collection', label: 'Whole collection' },
  { value: 'walk', label: '3D gallery' },
]

// The room is a visit, not a habit: it loads a renderer and a wall of artwork, so it is never
// the remembered tab — leaving it returns to whichever listing view was chosen before
const STATUS_VALUES = STATUS_TABS.filter((tab) => tab.value !== 'walk').map((tab) => tab.value)

/**
 * Collection View
 * The collection page: its onchain identity up top (CollectionHeader) and this app's
 * market activity for it below — the collection's listings as the same NftMarketCard
 * tiles the market grid uses, switchable between live, sold and everything.
 * @param {Object} props
 * @param {string} props.networkId Chain id, from the URL segment.
 * @param {string} props.address Collection contract address, from the URL segment.
 */
export default function CollectionView({ networkId, address }) {
  const chainId = Number(networkId)
  const chainInfo = appChains.find((chain) => chain.id === chainId)
  const collection = address.toLowerCase()
  // Computed once, ahead of the memoized hooks below, so the compiler can keep their memo
  const chainStyle = networkColorStyle(chainInfo)

  const info = useCollectionInfo({ chainId, collection })
  const stats = useCollectionStats({ chainId, collection, chainInfo })

  // Both of these are the reader's habit rather than the collection's, so they are remembered
  // across collections. Density is shared by both grids, so switching tabs never reshapes the page
  const [status, setStatus] = useStoredChoice('nft-collection-status', STATUS_VALUES, 'active')
  const [isWalking, setIsWalking] = useState(false)
  const [layout, setLayout] = useGridLayout('nft-collection-layout')
  // Bumped after a sweep, to remount the browse grid. Its token list is a plain fetch, not an
  // SWR key, so a sweep that dropped rows for tokens that don't exist would otherwise keep
  // showing them until a reload — the one refresh outcome the user can actually see.
  const [browseKey, setBrowseKey] = useState(0)
  // [{label, value}] — values sharing a label widen the result, different labels narrow it.
  // The server does the matching against cached token metadata; see the traits API route.
  const [traits, setTraits] = useState([])
  const [items, setItems] = useState([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isFetchingMore, setIsFetchingMore] = useState(false)

  const view = isWalking ? 'walk' : status
  const handleViewChange = (value) => {
    if (value === 'walk') {
      setIsWalking(true)
      return
    }
    setIsWalking(false)
    setStatus(value)
  }

  // Neither uses the listing grid's own fetch: the browse tab reads the collection's tokens
  // and the room pages the live listings itself, so the grid's chrome (traits, load more)
  // stands down for either
  const isBrowsingCollection = status === 'collection' || isWalking

  const tableRows = items.map((listing) => ({
    key: `${listing.network_id}-${listing.listing_id}`,
    tokenId: listing.token_id,
    isLsp8: Boolean(Number(listing.is_lsp8)),
    listingId: listing.listing_id,
    price: listing.price,
    symbol: listing.symbol || chainInfo?.nativeCurrency?.symbol || '',
    decimals: listing.decimals ?? chainInfo?.nativeCurrency?.decimals,
    lastSalePrice: listing.last_sale_price || null,
    lastSaleSymbol: listing.last_sale_symbol || chainInfo?.nativeCurrency?.symbol || '',
    lastSaleDecimals: listing.last_sale_decimals ?? chainInfo?.nativeCurrency?.decimals,
    isSold: Number(listing.status) === 2,
    // Escrowed by HupTrade while listed, so the seller is the owner in every sense a buyer
    // cares about — and the row already carries their name from the users join
    owner: listing.wallet_address || null,
    ownerName: listing.display_name || null,
    listedAt: listing.listed_at || null,
    // The whole row, so the action cell can carry a real quick buy
    listing,
  }))

  // The facet list is scoped to the same status the grid shows, so a count next to a value
  // is always the number of NFTs ticking it would leave on screen. The browse tab has no
  // listing status — the panel is hidden there, so what this fetches doesn't matter, but the
  // API only speaks listing statuses.
  const traitFacets = useCollectionTraits({ chainId, collection, status: isBrowsingCollection ? 'active' : status })

  // Rarity and floor are the table's two columns nothing else on the page needs, so both
  // wait for the layout that shows them. Fetched here rather than in each grid: the browse
  // tab reads the same two answers, and one collection has one ranking and one floor.
  const isTable = layout === 'list'
  const rarity = useCollectionRarity({ chainId, collection, totalSupply: info.totalSupply, enabled: isTable })
  const floor = useCollectionFloor({ chainId, collection, chainInfo, enabled: isTable })
  const topOffers = useCollectionTopOffers({ chainId, collection, chainInfo, enabled: isTable })

  const buildFilters = useCallback(
    () => ({
      networkId: String(chainId),
      collection,
      status: status === 'active' ? '' : status,
      traits: traits.length > 0 ? JSON.stringify(traits) : '',
    }),
    [chainId, collection, status, traits],
  )

  useEffect(() => {
    // The browse tab doesn't read listings at all — CollectionBrowser owns its own fetching,
    // and skipping here keeps the listing grid warm for the tab the user switches back to
    if (isBrowsingCollection) return

    let cancelled = false

    const load = async () => {
      setIsLoading(true)
      try {
        const res = await getNftListings(1, PAGE_SIZE, buildFilters())
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
    load()

    return () => {
      cancelled = true
    }
  }, [buildFilters, isBrowsingCollection])

  const loadMore = async () => {
    if (isFetchingMore || !hasMore) return
    setIsFetchingMore(true)
    const nextPage = page + 1

    try {
      const res = await getNftListings(nextPage, PAGE_SIZE, buildFilters())
      setItems((prev) => [...prev, ...(res.data || [])])
      setHasMore(res.meta?.hasMore || false)
      setPage(nextPage)
    } catch {
      // A retry click picks it back up — no need to surface an error for a load-more miss
    } finally {
      setIsFetchingMore(false)
    }
  }

  // Same whole-collection escape hatch the market grid and listing page offer — every
  // tile on this page belongs to the collection, so it earns the sweep button
  const collectionRefresh = useCollectionMetadataRefresh({ chainId, collection })

  const isRefreshing = collectionRefresh.isRefreshing || info.isRefreshing

  // On this page "the collection" is more than its tokens: the identity header (banner,
  // description, links, supply) re-reads first — it's one row and updates in place — then
  // the token sweep walks the cached artwork. The sweep's toast carries the outcome; a
  // throttled identity refresh stays quiet rather than aborting the sweep.
  const handleRefreshCollection = async () => {
    try {
      await info.refresh()
      const result = await collectionRefresh.refresh()
      if (!result) return
      if (result.removed > 0) setBrowseKey((key) => key + 1)
      toast(...describeCollectionRefresh(result))
    } catch (error) {
      toast(error.message || 'Could not refresh the collection', 'error')
    }
  }

  return (
    // Colours come from the collection's chain, not the connected wallet's
    <div className={`${styles.collection} animate fade`} style={chainStyle}>
      {/* Fixed-header + document title carry the collection's name; the clearance spacer
          already renders at page level, outside the container */}
      <PageTitle name={info.name || 'NFT collection'} spacer={false} />

      <CollectionHeader
        chainId={chainId}
        chainInfo={chainInfo}
        address={collection}
        info={info}
        stats={stats}
        onRefresh={handleRefreshCollection}
        isRefreshing={isRefreshing}
      />

      {/* Above the market, because what you already hold is the more immediate thing —
          renders nothing at all when disconnected or holding none here */}
      <OwnedTokens chainId={chainId} collection={collection} collectionName={info.name} isLsp8={info.isLsp8} />

      {/* What the floor has done, before the listings that make it up */}
      <FloorChart chainId={chainId} collection={collection} chainInfo={chainInfo} />

      <section className={styles.collection__market} aria-label="Collection listings">
        <div className={styles.collection__toolbar}>
          {/* What is being shown, then how it is shown — one row of identically cut pills,
              with the density switch last because it reshapes rather than re-queries */}
          <div className={styles.collection__filters}>
            {/* Tabs rather than a pressed group: each one swaps the grid below for a different
                set of NFTs, which is the panel a tablist exists to describe */}
            <SegmentedControl options={STATUS_TABS} value={view} onChange={handleViewChange} label="Listing status" as="tabs" />

            {/* Drives whichever grid is showing — the listings or the whole collection; the
                room has no density to switch */}
            {!isWalking && <LayoutToggle value={layout} onChange={setLayout} label="Grid layout" />}
          </div>

          <div className={styles.collection__tools}>
            {/* Traits filter listings; the browse tab shows tokens whether or not they were
                ever listed, so the panel would claim a scope it doesn't have */}
            {!isBrowsingCollection && (
              <TraitFilter
                traits={traitFacets.traits}
                selected={traits}
                onChange={setTraits}
                isLoading={traitFacets.isLoading}
                listed={traitFacets.listed}
                resolved={traitFacets.resolved}
              />
            )}
          </div>
        </div>

        {/* Applied traits, each removable on its own — the panel behind the funnel is where
            they were picked, but a filtered grid has to show what is filtering it */}
        {traits.length > 0 && !isBrowsingCollection && (
          <div className={styles.collection__chips}>
            {traits.map((trait) => (
              <button
                key={`${trait.label}:${trait.value}`}
                type="button"
                className={styles.collection__chip}
                onClick={() => setTraits((current) => current.filter((pair) => !(pair.label === trait.label && pair.value === trait.value)))}
                aria-label={`Remove the ${trait.label} ${trait.value} filter`}
              >
                <small>{trait.label}</small>
                <span>{trait.value}</span>
                <XIcon size={12} />
              </button>
            ))}

            <button type="button" className={styles.collection__chipsClear} onClick={() => setTraits([])}>
              Clear all
            </button>
          </div>
        )}

        {isWalking ? (
          <CollectionGallery key={browseKey} chainId={chainId} collection={collection} collectionName={info.name} isLsp8={info.isLsp8} chainInfo={chainInfo} />
        ) : isBrowsingCollection ? (
          <CollectionBrowser
            key={browseKey}
            chainId={chainId}
            collection={collection}
            collectionName={info.name}
            isLsp8={info.isLsp8}
            totalSupply={info.totalSupply}
            chainInfo={chainInfo}
            layout={layout}
            rarity={rarity}
            floor={floor}
            topOffers={topOffers}
          />
        ) : items.length === 0 && !isLoading ? (
          <p className={styles.collection__empty}>
            {traits.length > 0
              ? 'No NFT here matches those traits — try removing one.'
              : status === 'active'
              ? 'Nothing from this collection is up for sale right now.'
              : 'No listings match this view.'}
          </p>
        ) : isTable ? (
          <CollectionTable
            chainId={chainId}
            collection={collection}
            collectionName={info.name}
            rows={tableRows}
            rarity={rarity}
            floor={floor}
            topOffers={topOffers}
            isLoading={isLoading}
          />
        ) : isLoading ? (
          <div className={styles.collection__grid} data-layout={layout}>
            {/* 12 divides by both column counts, so the skeleton never ends on an orphan row */}
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className={styles.collection__skeletonTile} />
            ))}
          </div>
        ) : (
          <div className={styles.collection__grid} data-layout={layout}>
            {items.map((listing) => (
              <NftMarketCard key={`${listing.network_id}-${listing.listing_id}`} listing={listing} layout={layout} />
            ))}
          </div>
        )}

        {hasMore && !isLoading && !isBrowsingCollection && (
          <div className={styles.collection__loadMoreWrap}>
            <button type="button" className={styles.collection__loadMore} onClick={loadMore} disabled={isFetchingMore}>
              {isFetchingMore ? 'Loading...' : 'Load more'}
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

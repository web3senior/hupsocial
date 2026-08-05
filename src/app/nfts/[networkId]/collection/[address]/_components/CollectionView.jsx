'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import clsx from 'clsx'
import { ArrowsClockwiseIcon, CaretLeftIcon, StorefrontIcon } from '@phosphor-icons/react'
import { getNftListings } from '@/lib/api'
import { appChains } from '@/config/contracts'
import useCollectionInfo from '@/hooks/useCollectionInfo'
import useCollectionMetadataRefresh, { describeCollectionRefresh } from '@/hooks/useCollectionMetadataRefresh'
import { toast } from '@/components/NextToast'
import PageTitle from '@/components/PageTitle'
import NftMarketCard from '@/components/NftMarketCard'
import CollectionHeader from './CollectionHeader'
import styles from './CollectionView.module.scss'

const PAGE_SIZE = 24

const STATUS_TABS = [
  { value: 'active', label: 'For sale' },
  { value: 'sold', label: 'Sold' },
  { value: 'all', label: 'Everything' },
]

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
  const router = useRouter()

  const chainId = Number(networkId)
  const chainInfo = appChains.find((chain) => chain.id === chainId)
  const collection = address.toLowerCase()

  const info = useCollectionInfo({ chainId, collection })

  const [status, setStatus] = useState('active')
  const [items, setItems] = useState([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isFetchingMore, setIsFetchingMore] = useState(false)

  const buildFilters = useCallback(
    () => ({ networkId: String(chainId), collection, status: status === 'active' ? '' : status }),
    [chainId, collection, status],
  )

  useEffect(() => {
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
  }, [buildFilters])

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
      toast(...describeCollectionRefresh(result))
    } catch (error) {
      toast(error.message || 'Could not refresh the collection', 'error')
    }
  }

  return (
    <div className={`${styles.collection} animate fade`}>
      {/* Fixed-header + document title carry the collection's name; the clearance spacer
          already renders at page level, outside the container */}
      <PageTitle name={info.name || 'NFT collection'} spacer={false} />
      <button type="button" className={styles.collection__back} onClick={() => router.back()}>
        <CaretLeftIcon size={16} />
        Back
      </button>

      <CollectionHeader chainId={chainId} chainInfo={chainInfo} address={collection} info={info} />

      <section className={styles.collection__market} aria-label="Collection listings">
        <div className={styles.collection__toolbar}>
          <div className={styles.collection__tabs} role="group" aria-label="Listing status">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                className={clsx(styles.collection__tab, status === tab.value && styles['collection__tab--active'])}
                aria-pressed={status === tab.value}
                onClick={() => setStatus(tab.value)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className={styles.collection__tools}>
            <button
              type="button"
              className={styles.collection__tool}
              onClick={handleRefreshCollection}
              disabled={isRefreshing}
              title="Re-read the collection's banner, description, links and every NFT from the blockchain"
            >
              <ArrowsClockwiseIcon size={14} className={clsx(isRefreshing && styles['collection__tool--spinning'])} />
              Refresh collection
            </button>

            {/* The market grid's full funnel (price, currency, seller) pre-filtered to
                this collection */}
            <Link href={`/nfts?networkId=${chainId}&collection=${collection}`} className={styles.collection__tool}>
              <StorefrontIcon size={14} />
              Open in market
            </Link>
          </div>
        </div>

        {isLoading ? (
          <div className={styles.collection__grid}>
            {/* 12 divides by both column counts, so the skeleton never ends on an orphan row */}
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className={styles.collection__skeletonTile} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className={styles.collection__empty}>
            {status === 'active' ? 'Nothing from this collection is up for sale right now.' : 'No listings match this view.'}
          </p>
        ) : (
          <div className={styles.collection__grid}>
            {items.map((listing) => (
              <NftMarketCard key={`${listing.network_id}-${listing.listing_id}`} listing={listing} />
            ))}
          </div>
        )}

        {hasMore && !isLoading && (
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

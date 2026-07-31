'use client'

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { StackIcon } from '@phosphor-icons/react'
import { getNftCollections } from '@/lib/api'
import { appChains } from '@/config/contracts'
import { formatStake } from '@/hooks/useStakeToken'
import { handleBrokenImage } from '@/lib/utils'
import useNftMetadata from '@/hooks/useNftMetadata'
import HupMark from '@/components/ui/HupMark'
import styles from './MarketHero.module.scss'

const HERO_LIMIT = 12
const COMPACT = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

// Same derivation NftMarketCard uses — wagmi's config stamps iconUrl onto the shared chain
// objects as a side effect, so don't depend on that module having been evaluated first
const chainIconFor = (chain) => {
  if (!chain) return null
  if (chain.iconUrl) return chain.iconUrl
  return chain.icon ? `data:image/svg+xml,${encodeURIComponent(chain.icon)}` : null
}

/**
 * One sample token's artwork. A hook can't be called in a loop over a variable-length list,
 * so the cover mosaic renders a fixed number of these instead — each one resolves its own
 * token through the same SWR-immutable cache the grid cards use, so tokens already on screen
 * below cost nothing to draw up here.
 * @param {Object} props
 * @param {Object} [props.sample] Row from the collections API; absent slots render nothing.
 * @param {Function} [props.onName] Called with the collection name once metadata resolves.
 */
function CoverTile({ networkId, collection, sample, onName, className }) {
  const metadata = useNftMetadata({
    chainId: networkId,
    collection,
    tokenId: sample?.token_id,
    isLsp8: Boolean(Number(sample?.is_lsp8)),
    enabled: Boolean(sample),
    imageWidth: 256,
    still: true,
  })

  useEffect(() => {
    if (metadata.collectionName) onName?.(metadata.collectionName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metadata.collectionName])

  if (!sample) return null

  return (
    <div className={clsx(styles.hero__cover, className)}>
      {metadata.image ? (
        <img src={metadata.image} alt="" loading="lazy" onError={handleBrokenImage} />
      ) : (
        <span className={styles.hero__coverFallback}>
          <HupMark size={22} />
        </span>
      )}
    </div>
  )
}

/**
 * Collection Card
 * A single showcased collection: a mosaic of its most recent listings, the collection name
 * once it resolves onchain, and the two numbers a buyer scans for — how many are up, and
 * what the cheapest one costs.
 */
function CollectionCard({ collection, isActive, onSelect }) {
  const networkId = Number(collection.network_id)
  const chain = appChains.find((c) => c.id === networkId)
  const chainIcon = chainIconFor(chain)

  // Collection names live onchain, not in the index — the first cover tile to resolve one
  // names the card, and the grid's Collection filter borrows it (see onSelect)
  const [name, setName] = useState(null)

  const samples = collection.samples || []
  const activeCount = Number(collection.active_count) || 0
  const soldCount = Number(collection.sold_count) || 0

  // store_tokens has no row for native currency, so its symbol/decimals come from the chain
  const isNative = !collection.floor_token || collection.floor_token === '0x0000000000000000000000000000000000000000'
  const floorDecimals = collection.floor_decimals ?? (isNative ? chain?.nativeCurrency?.decimals : undefined)
  const floorSymbol = collection.floor_symbol || (isNative ? chain?.nativeCurrency?.symbol : '')
  const floorPrice = formatStake(collection.floor_price, floorDecimals)

  return (
    <button
      type="button"
      className={clsx(styles.hero__card, isActive && styles['hero__card--active'])}
      aria-pressed={isActive}
      onClick={() => onSelect(collection, name)}
    >
      <div className={clsx(styles.hero__mosaic, samples.length < 2 && styles['hero__mosaic--single'])}>
        <CoverTile networkId={networkId} collection={collection.collection} sample={samples[0]} onName={setName} />
        {samples.length > 1 && (
          <div className={styles.hero__mosaicSide}>
            <CoverTile networkId={networkId} collection={collection.collection} sample={samples[1]} onName={setName} />
            <CoverTile networkId={networkId} collection={collection.collection} sample={samples[2]} onName={setName} />
          </div>
        )}
        {chainIcon && <img className={styles.hero__chain} src={chainIcon} alt="" title={chain?.name} />}
      </div>

      <div className={styles.hero__meta}>
        <span className={clsx(styles.hero__name, !name && styles['hero__name--pending'])}>{name || 'Loading…'}</span>

        <div className={styles.hero__stats}>
          <span className={styles.hero__stat}>
            <StackIcon size={12} weight="fill" />
            {COMPACT.format(activeCount)} listed
          </span>
          {floorPrice && (
            <span className={styles.hero__stat}>
              Floor <b>{floorPrice}</b> {floorSymbol}
            </span>
          )}
        </div>

        {/* Reserved even when empty so every card in the rail keeps a common baseline */}
        <span className={styles.hero__sold}>{soldCount > 0 ? `${COMPACT.format(soldCount)} sold` : ''}</span>
      </div>
    </button>
  )
}

/**
 * NFT Market Hero
 * The showcase rail above the grid: collections that currently have something listed, ranked
 * by how many. Selecting a card filters the grid to that collection on its own chain;
 * selecting it again clears back to everything.
 * @param {Object} props
 * @param {string} [props.networkId] The grid's network filter — scopes the rail to match.
 * @param {string} [props.activeCollection] Lower-cased address the grid is filtered to.
 * @param {Function} props.onSelectCollection Called with (networkId, address, name|null).
 */
export default function MarketHero({ networkId, activeCollection, onSelectCollection }) {
  const [collections, setCollections] = useState([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setIsLoading(true)
      try {
        const res = await getNftCollections(HERO_LIMIT, networkId || undefined)
        if (cancelled) return
        setCollections(res.data || [])
      } catch {
        if (!cancelled) setCollections([])
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()

    return () => {
      cancelled = true
    }
  }, [networkId])

  // Nothing listed on the selected chain — the grid's own empty state already says so, and a
  // rail of skeletons that never fills would just be noise
  if (!isLoading && collections.length === 0) return null

  const handleSelect = (collection, name) => {
    const address = collection.collection.toLowerCase()
    if (address === activeCollection) {
      onSelectCollection(null, null, null)
      return
    }
    onSelectCollection(String(collection.network_id), address, name)
  }

  return (
    <section className={styles.hero} aria-label="Listed collections">
      <header className={styles.hero__header}>
        <h2 className={styles.hero__heading}>Collections on the market</h2>
        <p className={styles.hero__subheading}>Tap a collection to filter the market</p>
      </header>

      <div className={styles.hero__rail}>
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => <div key={i} className={styles.hero__skeleton} />)
          : collections.map((collection) => (
              <CollectionCard
                key={`${collection.network_id}-${collection.collection}`}
                collection={collection}
                isActive={collection.collection.toLowerCase() === activeCollection}
                onSelect={handleSelect}
              />
            ))}
      </div>
    </section>
  )
}

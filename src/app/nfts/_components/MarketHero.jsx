'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { CaretDownIcon, CaretLeftIcon, CaretRightIcon, CaretUpIcon, MinusIcon, StackIcon } from '@phosphor-icons/react'
import { getNftCollections, getNftCollectionsHistory } from '@/lib/api'
import { appChains } from '@/config/contracts'
import { formatStake } from '@/hooks/useStakeToken'
import CollectionCover from '@/components/CollectionCover'
import useRailScroll from '@/hooks/useRailScroll'
import Sparkline from '@/components/ui/Sparkline'
import InfoHint from '@/components/ui/InfoHint'
import styles from './MarketHero.module.scss'

const HERO_LIMIT = 12
const COMPACT = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
// Named on the card ("30d") so the delta is never a percentage of an unstated period
const TREND_DAYS = 30
const PERCENT = new Intl.NumberFormat(undefined, { style: 'percent', signDisplay: 'exceptZero', maximumFractionDigits: 1 })

// Same derivation NftMarketCard uses — wagmi's config stamps iconUrl onto the shared chain
// objects as a side effect, so don't depend on that module having been evaluated first
const chainIconFor = (chain) => {
  if (!chain) return null
  if (chain.iconUrl) return chain.iconUrl
  return chain.icon ? `data:image/svg+xml,${encodeURIComponent(chain.icon)}` : null
}

/**
 * Where the floor has been, as a stat tile's trend line.
 *
 * Days with nothing live carry a null floor, and those are dropped rather than zero-filled or
 * carried forward — a flat run at zero would read as "the floor collapsed" when what actually
 * happened is that nobody was selling. The line then spans only the days that had a price.
 *
 * Values go in as raw base units: every point is quoted in one currency (see
 * lib/nftFloorHistory), and the sparkline normalizes to the series' own min/max, so scaling
 * them down by decimals first would redraw exactly the same shape.
 */
function TrendLine({ trend }) {
  const values = (trend?.points || []).filter((point) => point.floor !== null).map((point) => Number(point.floor))
  const change = trend?.change_pct

  // One quoted day is a price, not a trend — and change_pct is null in that case anyway
  if (values.length < 2 || change === null || change === undefined) return null

  // A floor that held all window is its own outcome, not a weak rise: an up caret over "0%"
  // claims a direction the number denies, so flat gets a dash and the muted ink
  const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
  const Caret = direction === 'up' ? CaretUpIcon : direction === 'down' ? CaretDownIcon : MinusIcon

  return (
    <div className={clsx(styles.hero__trend, styles[`hero__trend--${direction}`])}>
      {/* The caret and the sign both say which way this went, so the hue never carries the
          direction alone — teal/red sit in the CVD floor band (see globals.scss) */}
      <span className={styles.hero__delta}>
        <Caret size={11} weight="bold" aria-hidden="true" />
        {PERCENT.format(change / 100)}
        <small>{TREND_DAYS}d</small>
      </span>
      <Sparkline className={styles.hero__spark} values={values} from="currentColor" />
    </div>
  )
}

/**
 * Collection Card
 * A single showcased collection: the artwork it was given onchain — or, where it has none,
 * a mosaic of its most recent listings — the collection name, and the two numbers a buyer
 * scans for: how many are up, and what the cheapest one costs. Links to the collection page.
 * @param {Object} props
 * @param {Object} [props.trend] This collection's floor series, once the batch resolves.
 * Absent until then, and absent for good on collections with under two priced days.
 */
function CollectionCard({ collection, trend }) {
  const networkId = Number(collection.network_id)
  const chain = appChains.find((c) => c.id === networkId)
  const chainIcon = chainIconFor(chain)

  // The rollup carries the cached name; a collection nothing has resolved yet is named by
  // the first cover tile to read one instead, and only a cover showing the collection's own
  // artwork mounts no tiles — those always arrive named.
  const [resolvedName, setResolvedName] = useState(null)
  const name = collection.name || resolvedName

  const activeCount = Number(collection.active_count) || 0
  const soldCount = Number(collection.sold_count) || 0

  // store_tokens has no row for native currency, so its symbol/decimals come from the chain
  const isNative = !collection.floor_token || collection.floor_token === '0x0000000000000000000000000000000000000000'
  const floorDecimals = collection.floor_decimals ?? (isNative ? chain?.nativeCurrency?.decimals : undefined)
  const floorSymbol = collection.floor_symbol || (isNative ? chain?.nativeCurrency?.symbol : '')
  const floorPrice = formatStake(collection.floor_price, floorDecimals)

  return (
    <Link href={`/nfts/${networkId}/collection/${collection.collection.toLowerCase()}`} className={styles.hero__card}>
      {/* A square box, so the square icon leads; a wide banner standing in for it is
          centre-cropped to the same shape */}
      <CollectionCover row={collection} prefer="icon" width={512} onName={setResolvedName} className={styles.hero__cover}>
        {chainIcon && <img className={styles.hero__chain} src={chainIcon} alt="" title={chain?.name} />}
      </CollectionCover>

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
          {soldCount > 0 && <span className={styles.hero__stat}>{COMPACT.format(soldCount)} sold</span>}
        </div>

        {/* Reserved even when empty so every card in the rail keeps a common baseline */}
        <div className={styles.hero__trendRow}>
          <TrendLine trend={trend} />
        </div>
      </div>
    </Link>
  )
}

/**
 * NFT Market Hero
 * The showcase rail above the grid: collections that currently have something listed, ranked
 * by how many. Each card links to the collection's own page — banner, description, creators
 * and every listing. Filtering the grid in place stays available through the funnel.
 * @param {Object} props
 * @param {string} [props.networkId] The grid's network filter — scopes the rail to match.
 */
export default function MarketHero({ networkId }) {
  const [collections, setCollections] = useState([])
  const [trends, setTrends] = useState({})
  const [isLoading, setIsLoading] = useState(true)
  const railRef = useRef(null)
  const { canScrollLeft, canScrollRight, scrollByPage } = useRailScroll(railRef, [collections, isLoading])
  const hasOverflow = canScrollLeft || canScrollRight

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

  // Deliberately a second pass rather than part of the rollup above: rebuilding 30 days of
  // floor history is the slow half of this screen, and the cards have everything they need to
  // paint without it. The trend lands in behind them.
  useEffect(() => {
    if (!collections.length) return

    let cancelled = false

    getNftCollectionsHistory(collections, TREND_DAYS)
      .then((res) => {
        if (cancelled) return
        // Merged into what's already there rather than replacing it. Entries are keyed by chain
        // and address, so one left over from a previous filter can only ever be missed by a
        // lookup, never mismatched — and switching the chain filter back finds it still loaded.
        setTrends((current) => {
          const next = { ...current }
          for (const row of res.data || []) next[`${row.network_id}-${row.collection}`] = row
          return next
        })
      })
      // A card without its sparkline is still a usable card, so a failure here stays silent
      // rather than taking the rail down with it
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [collections])

  // Nothing listed on the selected chain — the grid's own empty state already says so, and a
  // rail of skeletons that never fills would just be noise
  if (!isLoading && collections.length === 0) return null

  return (
    <section className={styles.hero} aria-label="Listed collections">
      <header className={styles.hero__header}>
        <h2 className={styles.hero__heading}>
          Collections on the{' '}
          {/* Glued to the last word, so a narrow header wraps the phrase and never strands the dot alone on a line */}
          <span className={styles.hero__headingTail}>
            market
            <InfoHint label="Collections on the market">
              {hasOverflow ? `${collections.length} collections — scroll sideways to see them all` : 'Tap a collection to open its page'}
            </InfoHint>
          </span>
        </h2>

        {/* Only once the rail actually overflows: arrows on a rail that fits would promise
            more cards than there are */}
        {hasOverflow && (
          <div className={styles.hero__arrows}>
            <button
              type="button"
              className={styles.hero__arrow}
              aria-label="Scroll collections left"
              disabled={!canScrollLeft}
              onClick={() => scrollByPage(-1)}
            >
              <CaretLeftIcon size={16} weight="bold" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.hero__arrow}
              aria-label="Scroll collections right"
              disabled={!canScrollRight}
              onClick={() => scrollByPage(1)}
            >
              <CaretRightIcon size={16} weight="bold" aria-hidden="true" />
            </button>
          </div>
        )}
      </header>

      <div
        ref={railRef}
        className={clsx(styles.hero__rail, canScrollLeft && styles['hero__rail--moreLeft'], canScrollRight && styles['hero__rail--moreRight'])}
      >
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => <div key={i} className={styles.hero__skeleton} />)
          : collections.map((collection) => (
              <CollectionCard
                key={`${collection.network_id}-${collection.collection}`}
                collection={collection}
                trend={trends[`${collection.network_id}-${collection.collection.toLowerCase()}`]}
              />
            ))}
      </div>
    </section>
  )
}

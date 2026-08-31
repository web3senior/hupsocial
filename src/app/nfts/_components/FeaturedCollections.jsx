'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { StarIcon } from '@phosphor-icons/react'
import { getNftCollectionRanking } from '@/lib/api'
import { appChains } from '@/config/contracts'
import { formatStake } from '@/hooks/useStakeToken'
import { isSameStoredImage, resolveStorageImageUrl } from '@/lib/storageHelper'
import { networkColorStyle } from '@/lib/networkColors'
import HupMark from '@/components/ui/HupMark'
import styles from './FeaturedCollections.module.scss'

// How many collections the banner cycles through, and how many ranking rows it reads to find
// them. A row the identity cache hasn't named yet can't front a banner — the ranking route
// reads a few of those from chain after every response, so they fill in over a page view or
// two — and the fetch leaves room to skip past them meanwhile.
const SLIDE_COUNT = 5
const FETCH_LIMIT = 12

// How long a slide holds before the next one comes in. Long enough to read four figures and
// decide whether to click, short enough that the fifth collection gets seen at all.
const ROTATE_MS = 7000

const COUNT = new Intl.NumberFormat()
const SHARE = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 })

// Same derivation the market cards, rail and table use — wagmi's config stamps iconUrl onto
// the shared chain objects as a side effect, so don't depend on that module having been
// evaluated first
const chainIconFor = (chain) => {
  if (!chain) return null
  if (chain.iconUrl) return chain.iconUrl
  return chain.icon ? `data:image/svg+xml,${encodeURIComponent(chain.icon)}` : null
}

/**
 * An amount in the collection's dominant payment token, or null when there is none to show.
 * Native-coin rows arrive with no symbol or decimals (store_tokens has no row for a chain's
 * own currency), so both come from the chain config — the same fill-in the ranking table does.
 * Zero reads as nothing rather than "0 LYX": a total of zero means nothing happened.
 */
const quote = (value, symbol, decimals, chain) => {
  const isNative = symbol == null && decimals == null
  const formatted = formatStake(value, decimals ?? (isNative ? chain?.nativeCurrency?.decimals : undefined))
  if (!formatted || formatted === '0') return null
  return { amount: formatted, symbol: symbol || (isNative ? chain?.nativeCurrency?.symbol : '') || '' }
}

// A ranking row's identity, as the slides and the dots are keyed
const keyOf = (row) => `${row.network_id}-${row.collection}`

// A banner that is the icon's own file is no banner: a square logo stretched 2.6:1 is worse
// than the icon blurred behind the name, which is what a slide does without one. The
// resolvers no longer cache such a banner, but rows written before they learned that live
// out their TTL, and chillwhales fronted the market that way for a day.
const bannerOf = (row) => (row.banner_uri && !isSameStoredImage(row.banner_uri, row.icon_uri) ? row.banner_uri : null)

/**
 * The top named collections, in server order; artwork never reorders the deck — an artless
 * slide falls back inside itself.
 * @param {Array<Object>} rows Ranking rows, in the order the server ranked them.
 * @returns {Array<Object>} At most SLIDE_COUNT rows.
 */
const pickSlides = (rows) => rows.filter((row) => row.name).slice(0, SLIDE_COUNT)

/**
 * The figures a buyer scans a collection by, as the banner prints them. Every one can be
 * unknown — a collection Hup hasn't read the supply of, one nothing has traded in, one with
 * nothing on the shelf — and an unknown prints as a dash rather than a zero, because zero
 * would be a claim.
 */
const buildStats = (row, chain) => {
  const supply = row.total_supply ? Number(row.total_supply) : 0
  const activeCount = Number(row.active_count) || 0

  return [
    {
      key: 'floor',
      label: 'Floor price',
      value: quote(row.floor_price, row.floor_symbol, row.floor_decimals, chain),
      title: 'The cheapest NFT you can buy right now',
    },
    {
      key: 'items',
      label: 'Items',
      value: supply > 0 ? { amount: COUNT.format(supply) } : null,
      title: 'How many NFTs the contract has minted',
    },
    {
      key: 'volume',
      label: 'Total volume',
      value: quote(row.volume_total, row.volume_symbol, row.volume_decimals, chain),
      title: 'Everything this collection has traded for on HupTrade, all time',
    },
    {
      key: 'listed',
      label: 'Listed',
      // A share of the supply where the supply is known, else the plain count — "69%" and
      // "69" answer the same question at two resolutions
      value: activeCount === 0 ? null : { amount: supply > 0 ? SHARE.format(activeCount / supply) : COUNT.format(activeCount) },
      title: activeCount > 0 ? `${COUNT.format(activeCount)} on the market right now` : 'Nothing on the market right now',
    },
  ]
}

/**
 * One artwork layer's source, and what to do when it fails. Artwork reaches the browser
 * through the image proxy, which resizes it — but the proxy can only serve what an IPFS
 * gateway still holds, and a banner the LUKSO indexer remembered may survive only on the
 * indexer's own CDN: First Beings' and HALO's last IPFS provider was Infura's node, which is
 * gone, and Winged Legends' has none at all. So a proxy miss retries the stored URL itself
 * when that is a plain https address, and only then is the layer given up.
 * @param {string|null} stored The URI as cached — ipfs://, https://, or null for none.
 * @param {string|null} proxied The proxy URL resolved for it.
 * @returns {{ src: string|null, onError: Function }} `src` is null once nothing is left to try.
 */
const useArtwork = (stored, proxied) => {
  const candidates = useMemo(() => {
    const list = []
    if (proxied) list.push(proxied)
    if (stored && /^https?:\/\//i.test(stored) && stored !== proxied) list.push(stored)
    return list
  }, [stored, proxied])
  const [attempt, setAttempt] = useState(0)

  // Two layers can show the same file — the icon blurred behind the name and sharp in the
  // corner — so one failure arrives twice; only the source that actually failed advances
  const onError = useCallback(
    (event) => {
      const failed = event.currentTarget.getAttribute('src')
      setAttempt((current) => (candidates[current] === failed ? current + 1 : current))
    },
    [candidates],
  )

  return { src: candidates[attempt] || null, onError }
}

/**
 * One featured collection: its banner artwork edge to edge, the name and chain over the lower
 * band, the four figures in a frosted panel, and the collection's own mark in the corner. The
 * whole slide is the link to the collection page.
 * @param {Object} props
 * @param {Object} props.row A ranking row, with its cached identity.
 * @param {number} props.index Position in the carousel.
 * @param {number} props.count How many slides there are.
 * @param {boolean} props.isActive Whether this is the slide on screen.
 */
function Slide({ row, index, count, isActive }) {
  const networkId = Number(row.network_id)
  const chain = appChains.find((c) => c.id === networkId)
  const chainIcon = chainIconFor(chain)
  const address = String(row.collection).toLowerCase()
  const bannerUri = bannerOf(row)

  // 1600 wide is what the collection page asks for, so the artwork a click lands on is the
  // very file the browser already holds
  const banner = useArtwork(bannerUri, resolveStorageImageUrl(bannerUri, { width: 1600 }))
  const icon = useArtwork(row.icon_uri, resolveStorageImageUrl(row.icon_uri, { width: 128, still: true }))
  const stats = buildStats(row, chain)

  // An image that fails — every gateway behind the proxy came up empty, and the CDN copy
  // after it — steps aside rather than swapping in a placeholder: at banner scale the
  // line-art mark would be the whole slide. The fallback is the next layer down, the blurred
  // icon, and after that the tinted plate. The slide itself stays: it earned its place on
  // volume, not on artwork, and failures don't arrive together — the proxy gives each gateway
  // seconds, the browser queues the low-priority banners, the CDN retry hangs on a slow host —
  // so a deck that shed slides as their images gave up emptied itself minutes into a page view.
  const showBanner = Boolean(banner.src)
  const showIcon = Boolean(icon.src)

  return (
    <Link
      href={`/nfts/${networkId}/collection/${address}`}
      className={styles.featured__slide}
      role="group"
      aria-roledescription="slide"
      aria-label={`${index + 1} of ${count}: ${row.name}`}
      // Only the slide on screen is reachable by keyboard: focusing one that isn't would
      // scroll the track to it mid-rotation, and the dots underneath are the way across
      aria-hidden={!isActive}
      tabIndex={isActive ? 0 : -1}
      // The plate tints with the collection's chain, not the wallet's, which :root carries
      style={networkColorStyle(chain)}
    >
      <div className={styles.featured__art}>
        {showBanner ? (
          <img
            className={styles.featured__banner}
            src={banner.src}
            alt=""
            decoding="async"
            fetchPriority={index === 0 ? 'high' : 'low'}
            onError={banner.onError}
          />
        ) : showIcon ? (
          // No banner onchain: the icon, blown up and blurred, so the slide still wears the
          // collection's own colours instead of a grey plate
          <img className={styles.featured__blur} src={icon.src} alt="" decoding="async" onError={icon.onError} />
        ) : (
          <HupMark size={64} />
        )}
      </div>

      {/* Top left, opposite the collection's mark — why this collection fronts the banner.
          "Featured" rather than "Trending": the slides rank on lifetime volume, and trending
          would claim a recent surge nothing here measures. */}
      <span className={styles.featured__flag}>
        <StarIcon size={11} weight="fill" aria-hidden="true" />
        Featured
      </span>

      {showIcon && <img className={styles.featured__logo} src={icon.src} alt="" decoding="async" onError={icon.onError} />}

      <div className={styles.featured__body}>
        <div className={styles.featured__titleRow}>
          <h2 className={styles.featured__name}>{row.name}</h2>
          {chainIcon && <img className={styles.featured__chain} src={chainIcon} alt={chain?.name || ''} title={chain?.name} />}
        </div>

        <dl className={styles.featured__stats}>
          {stats.map((stat) => (
            <div key={stat.key} className={clsx(styles.featured__stat, !stat.value && styles['featured__stat--empty'])} title={stat.title}>
              <dt>{stat.label}</dt>
              <dd>
                {stat.value ? (
                  <>
                    {stat.value.amount}
                    {stat.value.symbol && <small>{stat.value.symbol}</small>}
                  </>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Link>
  )
}

/**
 * Featured Collections
 * The full-width banner at the top of the NFT Market: the collections with the most traded
 * behind them, one at a time, each wearing its own banner artwork with the four figures a
 * buyer scans for — floor, items, total volume, how much of it is listed.
 *
 * Reads the same ranking the Collections view does, so identity (name, icon, banner, supply)
 * and every figure arrive in one cached response — no per-slide fetch, nothing read from
 * chain in the browser. Only collections whose name is already cached qualify; the ranking
 * route backfills the rest after each response, so a nameless collection earns its slot a
 * page view or two later.
 *
 * A native scroll-snap track underneath: a swipe on touch, the dots on anything, and a slow
 * rotation that stops while the pointer or focus is on it, while the tab is hidden, and for
 * readers who asked for less motion.
 * @param {Object} props
 * @param {string} [props.networkId] The market's chain filter — scopes the banner to match.
 */
export default function FeaturedCollections({ networkId }) {
  const [slides, setSlides] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [active, setActive] = useState(0)
  const [isHovered, setIsHovered] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [isHidden, setIsHidden] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)
  const trackRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setIsLoading(true)
      try {
        // Lifetime volume rather than the last day's: a hero that reshuffles every morning is
        // a hero nobody learns, and on a young market a day's ranking is mostly ties anyway
        const res = await getNftCollectionRanking({ limit: FETCH_LIMIT, networkId: networkId || undefined, sort: 'volumeTotal' })
        if (cancelled) return
        setSlides(pickSlides(res.data || []))
        // A new set starts from its first slide. The track itself remounts fresh — the
        // skeleton stood in for it while this loaded — so only the index has to follow.
        setActive(0)
      } catch {
        if (!cancelled) setSlides([])
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()

    return () => {
      cancelled = true
    }
  }, [networkId])

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduceMotion(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  // A rotation nobody is looking at only burns through the slides, so the reader comes back
  // to a different collection than they left
  useEffect(() => {
    const update = () => setIsHidden(document.hidden)
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  const goTo = useCallback(
    (index) => {
      const track = trackRef.current
      const count = slides.length
      if (!track || count === 0) return
      const next = ((index % count) + count) % count
      track.scrollTo({ left: next * track.clientWidth, behavior: reduceMotion ? 'instant' : 'smooth' })
    },
    [slides.length, reduceMotion],
  )

  // Keyed on `active` so a dot press restarts the clock — the slide someone chose gets its
  // full dwell, not whatever was left of the previous one's
  const isPaused = isHovered || isFocused || isHidden || reduceMotion || slides.length < 2

  useEffect(() => {
    if (isPaused) return
    const timer = setInterval(() => goTo(active + 1), ROTATE_MS)
    return () => clearInterval(timer)
  }, [isPaused, active, goTo])

  // The index comes from where the track actually is, so a swipe and a dot press agree
  const handleScroll = () => {
    const track = trackRef.current
    if (!track?.clientWidth) return
    setActive(Math.round(track.scrollLeft / track.clientWidth))
  }

  // Nothing named on the selected chain — the rail and the grid below already say what is
  // there, and a banner with no artwork would only push them down the page
  if (!isLoading && slides.length === 0) return null

  if (isLoading) {
    return (
      <section className={styles.featured} aria-label="Featured collections" aria-busy="true">
        <div className={styles.featured__skeleton} />
      </section>
    )
  }

  return (
    <section
      className={styles.featured}
      aria-roledescription="carousel"
      aria-label="Featured collections"
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
      // Keyboard focus holds the slide, so a reader tabbing through the dots is not chasing
      // a moving target. A mouse click leaves focus on the dot too, and that one must not
      // count — the pointer has already moved on, and the banner would stay frozen until
      // the next click anywhere. :focus-visible is exactly that distinction.
      onFocus={(event) => setIsFocused(event.target.matches(':focus-visible'))}
      onBlur={() => setIsFocused(false)}
    >
      <div ref={trackRef} className={styles.featured__track} onScroll={handleScroll}>
        {slides.map((row, index) => (
          <Slide key={keyOf(row)} row={row} index={index} count={slides.length} isActive={index === active} />
        ))}
      </div>

      {slides.length > 1 && (
        <div className={styles.featured__dots}>
          {slides.map((row, index) => (
            <button
              key={keyOf(row)}
              type="button"
              className={clsx(styles.featured__dot, index === active && styles['featured__dot--active'])}
              aria-label={`Show ${row.name}`}
              aria-current={index === active ? 'true' : undefined}
              onClick={() => goTo(index)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

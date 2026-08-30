'use client'

import { useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import clsx from 'clsx'
import { RocketLaunchIcon, SquaresFourIcon, RankingIcon } from '@phosphor-icons/react'
import { appChains, CONTRACTS } from '@/config/contracts'
import Tooltip from '@/components/ui/Tooltip'
import FeaturedCollections from './FeaturedCollections'
import styles from './MarketViews.module.scss'

// Only chains with HupTrade deployed can have anything on this market, so only those earn a
// button in the chain strip — the same list the grid validates the URL's networkId against
const tradeChains = appChains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.trade)

// Same derivation the market cards, rail and table use — wagmi's config stamps iconUrl onto
// the shared chain objects as a side effect, so don't depend on that module having been
// evaluated first
const chainIconFor = (chain) => {
  if (!chain) return null
  if (chain.iconUrl) return chain.iconUrl
  return chain.icon ? `data:image/svg+xml,${encodeURIComponent(chain.icon)}` : null
}

// Both views load on demand, not just the second one. Only one is ever mounted, and they are
// nothing alike underneath: the grid drags in the market cards, the hero rail and the sell
// modal — wagmi, viem and a wallet flow behind them — while the ranking is a table and a
// fetch. Bundling them together made a reader who asked for the ranking download the whole
// of the shop to look at a league table.
const NftMarketGrid = dynamic(() => import('./NftMarketGrid'))
const CollectionsTable = dynamic(() => import('./CollectionsTable'))

const VIEWS = [
  { value: 'items', label: 'Items', Icon: SquaresFourIcon, hint: 'Every NFT on the market, filtered how you like' },
  { value: 'collections', label: 'Collections', Icon: RankingIcon, hint: 'The whole market as a league table — floor, volume, sales, market cap' },
]

// Chain-specific, so a network switch invalidates them — the same clearing the grid's own
// network filter does
const CHAIN_SCOPED_PARAMS = ['collection', 'token']

/**
 * Market Views
 * The NFT Market has two readings — a grid of individual NFTs, and a ranking of the
 * collections they belong to — and this is the switch between them. Only one mounts at a
 * time: the grid keeps its loaded pages and scroll offset in a module-level cache keyed by
 * the query string, so switching to the table and back restores what was on screen rather
 * than re-fetching a page-1 skeleton.
 *
 * `view` lives in the URL alongside the grid's filters, so a link to the ranking is a link
 * to the ranking, and the browser's back button steps between the two readings.
 *
 * The chain filter is deliberately shared, and lives here rather than in either view. It is
 * the one filter that means the same thing on both sides, and a reader who narrowed the
 * grid to Base has already said which market they are looking at — so it sits in the
 * toolbar between the featured banner and whichever reading is up, as a strip of chain
 * logos, and both views read it from the URL.
 *
 * The page's card shell is rendered here rather than by the route so that toolbar — view
 * switch, chain strip, the way through to Drops — sits inside the card above either
 * reading. The card takes the large width for both: the grid gets a fourth column out of
 * it, and eleven columns of figures need every pixel a laptop can give them.
 * @param {Object} props
 * @param {string} props.shellClassName The route's card-shell class — passed down so
 * page.module.scss stays the page's, and only the width travels.
 */
export default function MarketViews({ shellClassName }) {
  const searchParams = useSearchParams()
  const view = searchParams.get('view') === 'collections' ? 'collections' : 'items'
  const networkId = searchParams.get('networkId') || ''

  /**
   * Writes one param without disturbing the rest — the grid rebuilds the whole query string
   * from its own filter set, which would drop `view` on the way past.
   *
   * replaceState rather than push: switching reading, like changing a filter, is not a place
   * the back button should have to step through on the way out of the page. Next tracks both
   * for useSearchParams, so the state below flows back in from the URL either way.
   */
  const setParam = useCallback(
    (key, value, alsoClear = []) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) params.set(key, value)
      else params.delete(key)
      for (const stale of alsoClear) params.delete(stale)

      const query = params.toString()
      window.history.replaceState(null, '', query ? `${window.location.pathname}?${query}` : window.location.pathname)
    },
    [searchParams],
  )

  const tabs = useMemo(
    () =>
      VIEWS.map((tab) => ({
        ...tab,
        isActive: tab.value === view,
      })),
    [view],
  )

  const isRanking = view === 'collections'

  // Pressing the chain that is already selected lets go of it — a pressed toggle that
  // cannot be unpressed sends the reader hunting for the "All" button
  const setNetwork = (value) => setParam('networkId', value === networkId ? '' : value, CHAIN_SCOPED_PARAMS)

  return (
    // The shared large step — the global container rule (styles/Global.scss) clears the
    // fixed sidebar with the live --aside-width, so the card needs no page-local sizing
    <div className={clsx('__container', shellClassName)} data-width={`xlarge`}>
      {/* Above the toolbar, so both readings open on the same showcase — it bleeds to the
          card's edges and follows the shared chain filter */}
      <FeaturedCollections networkId={networkId} />

      <div className={styles.views__toolbar}>
        <div className={styles.views__switch} role="group" aria-label="Market view">
          {tabs.map(({ value, label, Icon, hint, isActive }) => (
            <button
              key={value}
              type="button"
              title={hint}
              className={clsx(styles.views__tab, isActive && styles['views__tab--active'])}
              aria-pressed={isActive}
              onClick={() => setParam('view', value === 'items' ? '' : value)}
            >
              <Icon size={15} weight={isActive ? 'fill' : 'regular'} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>

        {/* The chain filter as a strip of logos: every network at a glance, the one in force
            ringed. Logos rather than names because the reader recognises a mark faster than
            a word, and the name is a hover away. */}
        <div className={styles.views__chains} role="group" aria-label="Network">
          <Tooltip content="Every network HupTrade runs on">
            <button
              type="button"
              className={clsx(styles.views__chain, styles['views__chain--all'], !networkId && styles['views__chain--active'])}
              aria-pressed={!networkId}
              onClick={() => setNetwork('')}
            >
              All
            </button>
          </Tooltip>

          {tradeChains.map((chain) => {
            const value = String(chain.id)
            const icon = chainIconFor(chain)
            const isActive = networkId === value

            return (
              <Tooltip key={chain.id} content={chain.name}>
                <button
                  type="button"
                  className={clsx(styles.views__chain, isActive && styles['views__chain--active'])}
                  aria-pressed={isActive}
                  aria-label={chain.name}
                  onClick={() => setNetwork(value)}
                >
                  {icon ? <img src={icon} alt="" /> : chain.name.slice(0, 1)}
                </button>
              </Tooltip>
            )
          })}
        </div>

        {/* Drops used to be a tab of the section strip above the page; with the strip gone,
            this is the way through to new mints from the market */}
        <Link href="/drops" className={styles.views__drops}>
          <RocketLaunchIcon size={15} weight="fill" aria-hidden="true" />
          Drops
        </Link>
      </div>

      {isRanking ? <CollectionsTable networkId={networkId} /> : <NftMarketGrid />}
    </div>
  )
}

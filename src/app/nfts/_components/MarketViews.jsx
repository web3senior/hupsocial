'use client'

import { useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import clsx from 'clsx'
import { SquaresFourIcon, RankingIcon } from '@phosphor-icons/react'
import styles from './MarketViews.module.scss'

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
 * The chain filter is deliberately shared. It is the one filter that means the same thing on
 * both sides, and a reader who narrowed the grid to Base has already said which market they
 * are looking at.
 *
 * The page's card shell is rendered here rather than by the route, because its width is a
 * property of the view: the grid is a feed and reads best in the section pages' shared
 * 768px column, while eleven columns of figures need every pixel a laptop can give them.
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

  return (
    // The ranking sizes itself rather than taking a shared data-width step — see
    // views__shell--wide, which has to clear the fixed sidebar the steps know nothing about.
    <div className={clsx('__container', shellClassName, isRanking && styles['views__shell--wide'])} data-width={isRanking ? undefined : 'medium'}>
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

      {isRanking ? (
        <CollectionsTable networkId={networkId} onNetworkChange={(value) => setParam('networkId', value, CHAIN_SCOPED_PARAMS)} />
      ) : (
        <NftMarketGrid />
      )}
    </div>
  )
}

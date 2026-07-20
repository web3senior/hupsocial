'use client'

import { useState } from 'react'
import Link from 'next/link'
import useSWRInfinite from 'swr/infinite'
import { useConnection } from 'wagmi'
import clsx from 'clsx'
import { CoinsIcon, StorefrontIcon, WalletIcon, ImageIcon, HandCoinsIcon } from '@phosphor-icons/react'
import PageTitle from '@/components/PageTitle'
import { ContentSpinner } from '@/components/Loading'
import { useClientMounted } from '@/hooks/useClientMount'
import RevenueHero from './_components/RevenueHero'
import SaleCard from './_components/SaleCard'
import styles from './page.module.scss'

const PAGE_SIZE = 20

const compactFormatter = new Intl.NumberFormat(undefined, { notation: 'compact' })

const TABS = [
  { key: 'bazaar', label: 'Bazaar' },
  { key: 'nfts', label: 'NFTs' },
  { key: 'tips', label: 'Tips' },
]

const EMPTY_TABS = {
  bazaar: {
    icon: StorefrontIcon,
    title: 'No sales yet',
    body: (
      <>
        When someone buys one of your listed items, every sale lands here.{' '}
        <Link href="/bazaar">Browse the Bazaar</Link> to see what selling looks like.
      </>
    ),
  },
  nfts: {
    icon: ImageIcon,
    title: 'No NFT sales yet',
    body: <>Attach an NFT listing to a post — when it sells, the trade shows up here.</>,
  },
  tips: {
    icon: HandCoinsIcon,
    title: 'No tips yet',
    body: <>When someone tips one of your posts, every tip lands here.</>,
  },
}

const fetcher = async (url) => {
  const response = await fetch(url)
  const json = await response.json()
  if (!response.ok || !json.success) throw new Error(json.error || 'Revenue failed to load')
  return json.data
}

export default function RevenuePage() {
  const mounted = useClientMounted()
  const { address, isConnected } = useConnection()
  const [tab, setTab] = useState('bazaar')
  const [network, setNetwork] = useState('all')
  const [networkOptions, setNetworkOptions] = useState([])

  const getKey = (pageIndex, previousPage) => {
    if (!isConnected || !address) return null
    if (previousPage && previousPage.next_cursor === null) return null
    const cursor = previousPage ? `&before=${previousPage.next_cursor}` : ''
    const chain = network === 'all' ? '' : `&network=${network}`
    return `/api/v1/users/${address}/revenue?source=${tab}&limit=${PAGE_SIZE}${chain}${cursor}`
  }

  // Totals and counts are identical across sources, so keeping previous data across a tab
  // switch leaves the hero and tabs in place — only the list area shows a loading state.
  const { data: pages, error, size, setSize, isLoading, isValidating } = useSWRInfinite(getKey, fetcher, {
    keepPreviousData: true,
  })

  const overview = pages?.[0]
  const rows = pages ? pages.flatMap((page) => page.rows) : []

  // Filter options come from the unfiltered load so picking a network doesn't
  // collapse the list down to itself. Guarded render-time state derivation.
  if (overview && network === 'all') {
    const options = [...new Map(overview.totals.map((t) => [t.network_id, t.network_name])).entries()]
    if (options.map(([id]) => id).join() !== networkOptions.map(([id]) => id).join()) setNetworkOptions(options)
  }
  const hasMore = Boolean(pages?.length && pages[pages.length - 1].next_cursor !== null)
  const totalPayments = overview ? overview.counts.bazaar + overview.counts.nfts + overview.counts.tips : 0
  const emptyTab = EMPTY_TABS[tab]

  return (
    <>
      <PageTitle name="Revenue" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="small">
          {!mounted ? null : !isConnected ? (
            <div className={styles.emptyState}>
              <WalletIcon size={48} />
              <h3>Connect your wallet</h3>
              <p>Connect your wallet to see your revenue.</p>
            </div>
          ) : error ? (
            <div className={styles.emptyState}>
              <CoinsIcon size={48} />
              <h3>Couldn&apos;t load Revenue</h3>
              <p>{error.message}</p>
            </div>
          ) : !overview ? (
            <div className={styles.page__loading}>
              <ContentSpinner size="32px" />
            </div>
          ) : totalPayments === 0 ? (
            <div className={styles.emptyState}>
              <StorefrontIcon size={48} />
              <h3>No revenue yet</h3>
              <p>
                Sales, NFT trades, and tips all land here.{' '}
                <Link href="/bazaar">Browse the Bazaar</Link> to see what selling looks like.
              </p>
            </div>
          ) : (
            <>
              <RevenueHero
                totals={overview.totals}
                supporterCount={overview.supporter_count}
                paymentsCount={totalPayments}
              />

              <div className={styles.page__toolbar}>
                <div className={styles.page__tabs} role="tablist" aria-label="Revenue source">
                  {TABS.map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={tab === key}
                      className={clsx(styles.page__tab, tab === key && styles['page__tab--active'])}
                      onClick={() => setTab(key)}
                    >
                      {label}
                      {overview.counts[key] > 0 && (
                        <span className={styles.page__tabCount}>{compactFormatter.format(overview.counts[key])}</span>
                      )}
                    </button>
                  ))}
                </div>

                {networkOptions.length > 1 && (
                  <select
                    className={styles.page__networkFilter}
                    aria-label="Filter by network"
                    value={network}
                    onChange={(event) => setNetwork(event.target.value)}
                  >
                    <option value="all">All networks</option>
                    {networkOptions.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name || `Chain ${id}`}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {overview.counts[tab] === 0 ? (
                <div className={styles.emptyState} data-compact="true">
                  <emptyTab.icon size={48} />
                  <h3>{emptyTab.title}</h3>
                  <p>{emptyTab.body}</p>
                </div>
              ) : isLoading ? (
                <div className={styles.page__listLoading}>
                  <ContentSpinner size="24px" />
                </div>
              ) : (
                <>
                  <ol className={styles.page__list}>
                    {rows.map((row) => (
                      <SaleCard key={row.id} sale={row} />
                    ))}
                  </ol>

                  {hasMore && (
                    <button
                      type="button"
                      className={styles.page__loadMore}
                      onClick={() => setSize(size + 1)}
                      disabled={isValidating}
                    >
                      {isValidating ? 'Loading…' : 'Load more'}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

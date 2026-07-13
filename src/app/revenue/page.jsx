'use client'

import Link from 'next/link'
import useSWRInfinite from 'swr/infinite'
import { useConnection } from 'wagmi'
import { CoinsIcon, StorefrontIcon, WalletIcon } from '@phosphor-icons/react'
import PageTitle from '@/components/PageTitle'
import { ContentSpinner } from '@/components/Loading'
import { useClientMounted } from '@/hooks/useClientMount'
import RevenueHero from './_components/RevenueHero'
import EarnSteps from './_components/EarnSteps'
import SaleCard from './_components/SaleCard'
import styles from './page.module.scss'

const PAGE_SIZE = 20

const fetcher = async (url) => {
  const response = await fetch(url)
  const json = await response.json()
  if (!response.ok || !json.success) throw new Error(json.error || 'Revenue failed to load')
  return json.data
}

export default function RevenuePage() {
  const mounted = useClientMounted()
  const { address, isConnected } = useConnection()

  const getKey = (pageIndex, previousPage) => {
    if (!isConnected || !address) return null
    if (previousPage && previousPage.next_cursor === null) return null
    const cursor = previousPage ? `&before=${previousPage.next_cursor}` : ''
    return `/api/v1/users/${address}/revenue?limit=${PAGE_SIZE}${cursor}`
  }

  const { data: pages, error, isLoading, size, setSize, isValidating } = useSWRInfinite(getKey, fetcher)

  const overview = pages?.[0]
  const sales = pages ? pages.flatMap((page) => page.sales) : []
  const hasMore = Boolean(pages?.length && pages[pages.length - 1].next_cursor !== null)

  return (
    <>
      <PageTitle name="Revenue" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="small">
          {!mounted ? null : !isConnected ? (
            <div className={styles.emptyState}>
              <WalletIcon size={48} />
              <h3>Connect your wallet</h3>
              <p>Connect your wallet to see your sales revenue.</p>
            </div>
          ) : isLoading ? (
            <div className={styles.page__loading}>
              <ContentSpinner size="32px" />
            </div>
          ) : error ? (
            <div className={styles.emptyState}>
              <CoinsIcon size={48} />
              <h3>Couldn&apos;t load Revenue</h3>
              <p>{error.message}</p>
            </div>
          ) : overview?.sales_count === 0 ? (
            <div className={styles.emptyState}>
              <StorefrontIcon size={48} />
              <h3>No sales yet</h3>
              <p>
                When someone buys one of your listed items, every sale lands here.{' '}
                <Link href="/bazzar">Browse the Bazzar</Link> to see what selling looks like.
              </p>
            </div>
          ) : (
            <>
              <RevenueHero
                totals={overview.totals}
                buyerCount={overview.buyer_count}
                unitsSold={overview.units_sold}
                salesCount={overview.sales_count}
              />

              <EarnSteps />

              <h3 className={styles.page__sectionTitle}>Sales</h3>
              <ol className={styles.page__list}>
                {sales.map((sale) => (
                  <SaleCard key={sale.id} sale={sale} />
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
        </div>
      </div>
    </>
  )
}

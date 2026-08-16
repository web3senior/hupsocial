'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { appChains } from '@/config/contracts'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { formatNative, formatPrice, formatTokenAmount, marketCapWei } from '@/lib/launch'
import LaunchCard from '@/components/LaunchCard'
import LaunchChart from './LaunchChart'
import { CoinIcon } from '@phosphor-icons/react'
import styles from './LaunchDetail.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

const timeFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'always', style: 'narrow' })

const toRelative = (unixSeconds) => {
  const delta = Number(unixSeconds) - Math.floor(Date.now() / 1000)
  const abs = Math.abs(delta)
  if (abs < 60) return relativeTime.format(Math.trunc(delta), 'second')
  if (abs < 3600) return relativeTime.format(Math.trunc(delta / 60), 'minute')
  if (abs < 86400) return relativeTime.format(Math.trunc(delta / 3600), 'hour')
  return relativeTime.format(Math.trunc(delta / 86400), 'day')
}

const shortAddress = (value) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '')

/**
 * Launch Detail
 * The standalone page for one launch — what a shill link off Hup points at. Trading itself is the
 * same LaunchCard the feed renders, so the buy/sell path has exactly one implementation.
 */
const LaunchDetail = ({ networkId, launchId, initialLaunch }) => {
  const { data: detail } = useSWR(`/api/v1/launches/${networkId}/${launchId}`, fetcher, {
    fallbackData: initialLaunch ? { success: true, data: initialLaunch } : undefined,
    refreshInterval: 30_000,
  })
  const { data: tradeData } = useSWR(`/api/v1/launches/${networkId}/${launchId}/trades?limit=200`, fetcher, {
    refreshInterval: 30_000,
  })

  const launch = detail?.data
  // Stable identity across renders — the chart series memo below depends on it
  const trades = useMemo(() => tradeData?.data ?? [], [tradeData])

  const chainInfo = useMemo(() => appChains.find((chain) => chain.id === networkId), [networkId])
  const nativeSymbol = chainInfo?.nativeCurrency?.symbol ?? 'ETH'

  // Last-trade price maintained by the indexer from each Swap's own sqrtPriceX96; the embedded
  // LaunchCard below reads the live one from the pool
  const priceWei = BigInt(launch?.price ?? 0)
  const imageUrl = launch?.image_cid ? resolveStorageImageUrl(launch.image_cid) : null

  if (!launch) {
    return <p className={styles.detail__empty}>This launch hasn’t been indexed yet, or doesn’t exist on this network.</p>
  }

  return (
    <div className={styles.detail}>
      <header className={styles.detail__header}>
        {imageUrl ? (
          <img src={imageUrl} alt="" className={styles.detail__image} />
        ) : (
          <span className={styles.detail__image} aria-hidden="true">
            <CoinIcon size={28} />
          </span>
        )}

        <div className={styles.detail__identity}>
          <h1>
            {launch.name} <em>${launch.symbol}</em>
          </h1>
          <p className={styles.detail__byline}>
            by{' '}
            <Link href={`/${launch.display_name || launch.wallet_address}`}>
              {launch.display_name || shortAddress(launch.wallet_address)}
            </Link>{' '}
            · {toRelative(launch.created_at)} · <span className={styles.detail__status}>Uniswap pool</span>
          </p>
          {launch.description && <p className={styles.detail__description}>{launch.description}</p>}
        </div>
      </header>

      <dl className={styles.detail__stats}>
        <div>
          <dt>Price</dt>
          <dd>
            {formatPrice(priceWei)} {nativeSymbol}
          </dd>
        </div>
        <div>
          <dt>Market cap</dt>
          <dd>
            {formatNative(marketCapWei(priceWei))} {nativeSymbol}
          </dd>
        </div>
        <div>
          <dt>Volume</dt>
          <dd>
            {formatNative(launch.volume_native)} {nativeSymbol}
          </dd>
        </div>
        <div>
          <dt>Trades</dt>
          <dd>{launch.trade_count ?? 0}</dd>
        </div>
        <div>
          <dt>Traders</dt>
          <dd>{launch.holder_count ?? 0}</dd>
        </div>
      </dl>

      {tradeData ? (
        <LaunchChart trades={trades} launch={launch} nativeSymbol={nativeSymbol} />
      ) : (
        // Trades arrive client-side, so the first paint has none. Saying so beats an empty
        // frame that claims a busy launch has never traded.
        <p className={styles.detail__chartEmpty}>Loading price history…</p>
      )}

      <LaunchCard launchRef={{ launchId, token: launch.token, chainId: networkId }} />

      {trades.length > 0 && (
        <section className={styles.detail__trades}>
          <h2>Recent trades</h2>
          <ul>
            {[...trades].reverse().slice(0, 30).map((trade) => (
              <li key={`${trade.tx_hash}-${trade.traded_at}-${trade.trader}`}>
                <span className={clsx(styles.detail__side, Number(trade.side) === 1 && styles['detail__side--sell'])}>
                  {Number(trade.side) === 1 ? 'Sell' : 'Buy'}
                </span>
                <Link href={`/${trade.display_name || trade.trader}`} className={styles.detail__trader}>
                  {trade.display_name || shortAddress(trade.trader)}
                </Link>
                <span className={styles.detail__amounts}>
                  {formatTokenAmount(trade.token_amount)} ${launch.symbol} · {formatNative(trade.native_amount)}{' '}
                  {nativeSymbol}
                </span>
                <small>{toRelative(trade.traded_at)}</small>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export default LaunchDetail

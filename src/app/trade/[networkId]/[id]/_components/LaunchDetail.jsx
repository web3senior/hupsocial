'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { usePublicClient } from 'wagmi'
import { CONTRACTS } from '@/config/contracts'
import { useQuoteAsset } from '@/hooks/useQuoteAsset'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import {
  formatQuote,
  formatPrice,
  formatTokenAmount,
  formatUsd,
  formatUsdFigure,
  marketCapWei,
  quoteWeiToUsd,
  readLaunchOnchain,
} from '@/lib/launch'
import LaunchCard from '@/components/LaunchCard'
import Profile from '@/components/Profile'
import EmptyState from '@/components/ui/EmptyState'
import { toast } from '@/components/NextToast'
import { tokenHref } from '@/lib/tokenRef'
import LaunchChart from './LaunchChart'
import LaunchFees from './LaunchFees'
import LaunchHolders from './LaunchHolders'
import LaunchLeaderboard from './LaunchLeaderboard'
import LaunchProfits from './LaunchProfits'
import { CheckIcon, CoinIcon, CopyIcon, LightningIcon, StorefrontIcon } from '@phosphor-icons/react'
import styles from './LaunchDetail.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

const clockFormat = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' })
const stampFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })
const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'always', style: 'narrow' })

const DAY_SECONDS = 86400
// Matches the `limit` on the trades fetch below — the window stats can only speak for a period
// the fetched page actually reaches back over
const TRADE_PAGE_SIZE = 200

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
  const { data: tradeData } = useSWR(
    `/api/v1/launches/${networkId}/${launchId}/trades?limit=${TRADE_PAGE_SIZE}`,
    fetcher,
    { refreshInterval: 30_000 },
  )
  // The same key LaunchHolders uses, so the face stack in the stat strip and the holders tab
  // share one request instead of each paying for their own
  const { data: holderData } = useSWR(`/api/v1/launches/${networkId}/${launchId}/holders?limit=50`, fetcher, {
    refreshInterval: 30_000,
  })

  // The indexer trails a fresh launch, so read the chain directly rather than telling someone
  // who just paid to create a token that it does not exist. Retries until the index catches up.
  const publicClient = usePublicClient({ chainId: networkId })
  const launchAddress = CONTRACTS[`chain${networkId}`]?.launch
  const missingFromIndex = Boolean(detail) && !detail.data
  const { data: onchainLaunch } = useSWR(
    missingFromIndex && publicClient && launchAddress ? ['launch-onchain', networkId, launchId] : null,
    () => readLaunchOnchain({ client: publicClient, launchAddress, networkId, launchId }),
    { refreshInterval: 15_000 },
  )

  const launch = detail?.data ?? onchainLaunch
  // Stable identity across renders — the chart series memo below depends on it
  const trades = useMemo(() => tradeData?.data ?? [], [tradeData])

  const [tab, setTab] = useState('trades')
  const [copied, setCopied] = useState(false)
  // Whatever this launch was paired against — the chain's coin, or the ERC20 an admin approved.
  // Resolved once here and passed down, so every figure on the page shares one scale and one
  // ticker rather than each component re-deriving them.
  const quote = useQuoteAsset(networkId, launch?.quote)
  const quoteSymbol = quote.symbol
  const quoteDecimals = quote.decimals

  // Wall-clock in state rather than read during render: Date.now() in a memo is impure, so the
  // 24h boundary would shift on any incidental re-render. Stays 0 until mounted so the server
  // and the first client paint agree.
  const [now, setNow] = useState(0)
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000))
    tick()
    const timer = window.setInterval(tick, 30_000)
    return () => window.clearInterval(timer)
  }, [])

  // Last-trade price maintained by the indexer from each Swap's own sqrtPriceX96; the embedded
  // LaunchCard below reads the live one from the pool
  const priceWei = BigInt(launch?.price ?? 0)
  const quoteUsd = launch?.quote_usd ?? null
  const imageUrl = launch?.image_cid ? resolveStorageImageUrl(launch.image_cid) : null

  /**
   * The moving figures, over the last 24 hours where the fetched page reaches that far back.
   *
   * The trades endpoint returns the most recent page, so on a busy token that page can be
   * entirely inside the window — and a 24h number computed from it would silently understate
   * both the volume and the change. Whether the page actually spans the window is therefore
   * part of the result, and the strip falls back to lifetime figures when it does not.
   */
  const window24h = useMemo(() => {
    if (!launch || !now) return null
    const cutoff = now - DAY_SECONDS

    const inWindow = trades.filter((trade) => Number(trade.traded_at) >= cutoff)
    const older = trades.filter((trade) => Number(trade.traded_at) < cutoff)
    // Either the page reaches past the cutoff, or the launch itself is younger than the window
    const spansWindow = older.length > 0 || Number(launch.created_at) >= cutoff || trades.length < TRADE_PAGE_SIZE

    const volume = inWindow.reduce((sum, trade) => sum + BigInt(trade.native_amount || 0), 0n)
    const buyVolume = inWindow
      .filter((trade) => Number(trade.side) === 0)
      .reduce((sum, trade) => sum + BigInt(trade.native_amount || 0), 0n)
    // Computed in wei so a single large sell can't be rounded away
    const buyShare = volume > 0n ? Number((buyVolume * 1000n) / volume) / 10 : null

    // The price the window opened at: the last trade before the cutoff, else where the pool
    // itself opened — only meaningful when the page covers the window
    const openingWei = older.length > 0 ? BigInt(older[older.length - 1].price || 0) : BigInt(launch.opening_price || 0)
    const changePct =
      spansWindow && openingWei > 0n ? (Number(priceWei - openingWei) / Number(openingWei)) * 100 : null

    return { spansWindow, volume, buyShare, changePct }
  }, [trades, launch, now, priceWei])

  const holders = holderData?.data ?? []

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(launch.token)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast('Could not copy the address', 'error')
    }
  }

  if (!launch) {
    return (
      <EmptyState icon={CoinIcon} align="center" size="lg">
        {missingFromIndex && launchAddress
          ? 'Looking for this launch onchain…'
          : 'No launch with that id on this network.'}
      </EmptyState>
    )
  }

  const marketCap = marketCapWei(priceWei)
  const capUsd = quoteUsd ? quoteWeiToUsd(marketCap, quoteUsd, quoteDecimals) : null
  const priceUsd = quoteUsd ? quoteWeiToUsd(priceWei, quoteUsd, quoteDecimals) : null
  // Lifetime volume stands in whenever the fetched page can't speak for a full day
  const showsWindow = Boolean(window24h?.spansWindow)
  const volumeWei = showsWindow ? window24h.volume : BigInt(launch.volume_native ?? 0)
  const volumeUsd = quoteUsd ? quoteWeiToUsd(volumeWei, quoteUsd, quoteDecimals) : null

  return (
    <div className={styles.detail}>
      {launch.pending && (
        <p className={styles.detail__pending} role="status">
          Live onchain and tradable now. Reading straight from the chain while the index catches up, so trades and holders
          will fill in shortly.
        </p>
      )}

      <header className={styles.detail__header}>
        {imageUrl ? (
          <img src={imageUrl} alt="" className={styles.detail__image} />
        ) : (
          <span className={styles.detail__image} aria-hidden="true">
            <CoinIcon size={32} />
          </span>
        )}

        <div className={styles.detail__identity}>
          <h1>{launch.name}</h1>

          <div className={styles.detail__meta}>
            <span className={styles.detail__symbol}>${launch.symbol}</span>

            <button type="button" className={styles.detail__address} onClick={handleCopy} title={launch.token}>
              {shortAddress(launch.token)}
              {copied ? <CheckIcon size={13} weight="bold" /> : <CopyIcon size={13} />}
            </button>

            <span className={styles.detail__rule} aria-hidden="true" />

            <span className={styles.detail__venue}>
              <LightningIcon size={14} weight="fill" />
              Uniswap pool
            </span>

            <span className={styles.detail__rule} aria-hidden="true" />

            <Profile
              creator={launch.wallet_address}
              networkId={networkId}
              variant="compact"
              size={22}
              fingerprint={false}
              className={styles.detail__creator}
            />

            <span className={styles.detail__rule} aria-hidden="true" />

            {/* The trading view is for someone who already knows what this is; the token page is
                what they send to somebody who doesn't */}
            <Link className={styles.detail__site} href={tokenHref(networkId, launch.token)}>
              <StorefrontIcon size={14} />
              Token page
            </Link>
          </div>

          {launch.description && <p className={styles.detail__description}>{launch.description}</p>}
        </div>
      </header>

      <dl className={styles.detail__stats}>
        <div>
          <dt>FDV</dt>
          <dd>
            <b>{capUsd !== null ? formatUsdFigure(capUsd) : `${formatQuote(marketCap, quoteDecimals)} ${quoteSymbol}`}</b>
            {window24h?.changePct !== null && window24h?.changePct !== undefined && (
              <em className={clsx(window24h.changePct >= 0 ? styles['detail__delta--up'] : styles['detail__delta--down'])}>
                {window24h.changePct >= 0 ? '▲' : '▼'} {Math.abs(window24h.changePct).toFixed(1)}%
              </em>
            )}
          </dd>
        </div>

        <div>
          <dt>Price</dt>
          <dd>
            <b>{priceUsd !== null ? formatUsd(priceUsd) : `${formatPrice(priceWei, 4, quoteDecimals)} ${quoteSymbol}`}</b>
          </dd>
        </div>

        <div>
          <dt>{showsWindow ? '24H volume' : 'Volume'}</dt>
          <dd>
            <b>
              {volumeUsd !== null ? formatUsdFigure(volumeUsd) : `${formatQuote(volumeWei, quoteDecimals)} ${quoteSymbol}`}
            </b>
            {showsWindow && window24h.buyShare !== null && (
              // Which side the window belonged to, not just what the split was
              <em className={clsx(window24h.buyShare >= 50 ? styles['detail__delta--up'] : styles['detail__delta--down'])}>
                {window24h.buyShare.toFixed(1)}% buys
              </em>
            )}
          </dd>
        </div>

        <div>
          <dt>Trades</dt>
          <dd>
            <b>{launch.trade_count ?? 0}</b>
          </dd>
        </div>

        <div>
          <dt>Holders</dt>
          <dd>
            <b>{launch.holder_count ?? 0}</b>
            {holders.length > 0 && (
              <span className={styles.detail__faces}>
                {holders.slice(0, 3).map((holder) => (
                  <Profile
                    key={holder.wallet_address}
                    creator={holder.wallet_address}
                    networkId={networkId}
                    variant="imageOnly"
                    size={26}
                    fingerprint={false}
                  />
                ))}
              </span>
            )}
          </dd>
        </div>
      </dl>

      {/* Three columns: the trader rail, the chart taking whatever is left, and the ticket. Named
          grid areas rather than source order, so the ticket can lead on a phone — the reason you
          opened this page there is to trade. */}
      <div className={styles.detail__workspace}>
        <div className={styles.detail__rail}>
          <LaunchProfits networkId={networkId} launchId={launchId} quote={quote} />
        </div>

        <div className={styles.detail__main}>
          {tradeData ? (
            <LaunchChart trades={trades} launch={launch} quote={quote} quoteUsd={quoteUsd} />
          ) : (
            // Trades arrive client-side, so the first paint has none. Saying so beats an empty
            // frame that claims a busy launch has never traded.
            <p className={styles.detail__chartEmpty}>Loading price history…</p>
          )}
        </div>

        <div className={styles.detail__ticket}>
          <LaunchCard launchRef={{ launchId, token: launch.token, chainId: networkId }} showSummary={false} />
          <LaunchFees networkId={networkId} launch={launch} />
        </div>
      </div>

      <section className={styles.detail__trades}>
        <div className={styles.detail__tabs} role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'trades'} onClick={() => setTab('trades')}>
            Activity
          </button>
          <button type="button" role="tab" aria-selected={tab === 'holders'} onClick={() => setTab('holders')}>
            {launch.holder_count > 0 ? `${launch.holder_count} holders` : 'Holders'}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'leaderboard'} onClick={() => setTab('leaderboard')}>
            Leaderboard
          </button>
        </div>

        {tab === 'holders' && <LaunchHolders networkId={networkId} launchId={launchId} quote={quote} />}

        {tab === 'leaderboard' && (
          <LaunchLeaderboard networkId={networkId} launchId={launchId} quote={quote} />
        )}

        {tab === 'trades' && trades.length === 0 && <EmptyState icon={CoinIcon}>No trades yet.</EmptyState>}

        {tab === 'trades' && trades.length > 0 && (
          // A tape is a table: six columns that line up down the page are read far faster than
          // six sentences. It scrolls inside its own box so the page never does.
          <div className={styles.detail__tableWrap}>
            <table className={styles.detail__table}>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Trade</th>
                  <th scope="col">Value</th>
                  <th scope="col">${launch.symbol}</th>
                  <th scope="col">Price</th>
                  <th scope="col">Trader</th>
                </tr>
              </thead>
              <tbody>
                {[...trades]
                  .reverse()
                  .slice(0, 30)
                  .map((trade) => {
                    const isSell = Number(trade.side) === 1
                    // The indexed column is named for the common case; it holds base units of
                    // whichever asset the launch is quoted in
                    const quoteAmount = BigInt(trade.native_amount || 0)
                    const tradeCapWei = marketCapWei(BigInt(trade.price || 0))
                    const tradedAt = Number(trade.traded_at) * 1000

                    return (
                      <tr key={`${trade.tx_hash}-${trade.traded_at}-${trade.trader}`}>
                        <td title={`${stampFormat.format(tradedAt)} · ${toRelative(trade.traded_at)}`}>
                          {clockFormat.format(tradedAt)}
                        </td>
                        <td className={clsx(styles.detail__side, isSell && styles['detail__side--sell'])}>
                          {isSell ? 'Sell' : 'Buy'}
                        </td>
                        <td className={styles.detail__num}>
                          {quoteUsd
                            ? formatUsd(quoteWeiToUsd(quoteAmount, quoteUsd, quoteDecimals))
                            : `${formatQuote(quoteAmount, quoteDecimals)} ${quoteSymbol}`}
                        </td>
                        <td className={styles.detail__num}>{formatTokenAmount(trade.token_amount)}</td>
                        <td className={styles.detail__num}>
                          {quoteUsd
                            ? `${formatUsdFigure(quoteWeiToUsd(tradeCapWei, quoteUsd, quoteDecimals))} FDV`
                            : `${formatPrice(BigInt(trade.price || 0), 4, quoteDecimals)} ${quoteSymbol}`}
                        </td>
                        <td>
                          {/* No networkId: every row on this page is the same chain, so the badge
                              would only repeat what the header already says */}
                          <span className={styles.detail__trader}>
                            <Profile creator={trade.trader} variant="compact" size={20} fingerprint={false} />
                          </span>
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

export default LaunchDetail

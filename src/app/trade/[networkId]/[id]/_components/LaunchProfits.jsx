'use client'

import useSWR from 'swr'
import clsx from 'clsx'
import { useConnection } from 'wagmi'
import { formatQuote, formatUsd, formatUsdCompact, quoteWeiToUsd } from '@/lib/launch'
import Profile from '@/components/Profile'
import EmptyState from '@/components/ui/EmptyState'
import { TrendUpIcon } from '@phosphor-icons/react'
import styles from './LaunchProfits.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

const RAIL_SIZE = 12

// Compact notation only earns its keep from four figures up; below that it rounds away the cents
const usdFigure = (value) =>
  value === null || value === undefined ? null : Math.abs(value) >= 1000 ? formatUsdCompact(value) : formatUsd(value)

/**
 * Launch Profits
 * Who is up and who is down on this token, in the rail beside the chart that explains why.
 *
 * The leaderboard tab further down answers the same question in full; this is the headline of it,
 * so both read from one request rather than each paying for their own.
 */
const LaunchProfits = ({ networkId, launchId, quote }) => {
  const quoteSymbol = quote?.symbol ?? 'ETH'
  const quoteDecimals = quote?.decimals ?? 18
  const { address } = useConnection()
  const me = address ? address.toLowerCase() : null

  // Deliberately the same key LaunchLeaderboard builds — SWR then serves both from one fetch
  const params = new URLSearchParams({ limit: '50' })
  if (me) params.set('me', me)

  const { data } = useSWR(`/api/v1/launches/${networkId}/${launchId}/leaderboard?${params}`, fetcher, {
    refreshInterval: 30_000,
  })

  const traders = data?.data ?? []
  const quoteUsd = data?.meta?.quote_usd ?? null
  // Ranked outside the page but still theirs to see
  const you = data?.meta?.you ?? null

  const asMoney = (wei) => {
    const value = BigInt(wei ?? 0)
    if (quoteUsd === null) return `${formatQuote(value, quoteDecimals)} ${quoteSymbol}`
    return usdFigure(quoteWeiToUsd(value, quoteUsd, quoteDecimals)) ?? '—'
  }

  const mine = you ?? traders.find((trader) => me !== null && String(trader.wallet_address).toLowerCase() === me)
  const rest = traders.filter((trader) => trader !== mine).slice(0, RAIL_SIZE)
  const cards = mine ? [mine, ...rest] : rest

  return (
    <section className={styles.profits}>
      <header className={styles.profits__header}>
        <h2>Holders</h2>
        <p>Profit taken plus the open position at the current price.</p>
      </header>

      {/* The rail is a declared grid track, so it always renders something — an empty column
          beside the chart would read as a layout fault rather than as a quiet token */}
      {!data && <EmptyState icon={TrendUpIcon}>Loading traders…</EmptyState>}
      {data && cards.length === 0 && <EmptyState icon={TrendUpIcon}>Nobody has traded this yet.</EmptyState>}

      {cards.length > 0 && (
        <ul className={styles.profits__list}>
          {cards.map((trader) => {
            const rank = Number(trader.rank_position)
            const spentWei = BigInt(trader.native_in ?? 0)
            const heldTokens = BigInt(trader.held ?? 0)
            const pnlWei = BigInt(trader.pnl ?? 0)
            // A wallet that was gifted the token and sold it made money with no cost basis, so it
            // has a profit and no percentage
            const roi = spentWei > 0n ? (Number(pnlWei) / Number(spentWei)) * 100 : null
            const isMe = me !== null && String(trader.wallet_address).toLowerCase() === me
            const up = pnlWei >= 0n

            return (
              <li
                key={trader.wallet_address}
                className={clsx(styles.profits__card, isMe && styles['profits__card--me'])}
              >
                <div className={styles.profits__identity}>
                  {/* No networkId: every card here is the same chain, so the badge would only
                      repeat what the header already says */}
                  <span className={styles.profits__who}>
                    <Profile creator={trader.wallet_address} variant="compact" size={26} fingerprint={false} />
                  </span>

                  <span className={styles.profits__tags}>
                    {isMe && <em className={styles.profits__you}>You</em>}
                    <em className={clsx(styles.profits__rank, rank <= 3 && styles[`profits__rank--${rank}`])}>
                      #{rank}
                    </em>
                  </span>
                </div>

                <dl className={styles.profits__figures}>
                  <div>
                    <dt>Position</dt>
                    <dd>
                      {heldTokens > 0n ? (
                        asMoney(trader.held_value)
                      ) : (
                        <span className={styles.profits__muted} title="Sold everything they bought here">
                          Closed
                        </span>
                      )}
                    </dd>
                  </div>

                  <div className={styles.profits__profit}>
                    <dt>Profit</dt>
                    <dd className={clsx(up ? styles['profits__pnl--up'] : styles['profits__pnl--down'])}>
                      <b>
                        {up ? '+' : '−'}
                        {asMoney(pnlWei < 0n ? -pnlWei : pnlWei)}
                      </b>
                      {roi !== null && (
                        <small>
                          {roi >= 0 ? '+' : '−'}
                          {Math.abs(roi).toFixed(1)}%
                        </small>
                      )}
                    </dd>
                  </div>
                </dl>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default LaunchProfits

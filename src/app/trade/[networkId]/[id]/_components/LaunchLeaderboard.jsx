'use client'

import useSWR from 'swr'
import clsx from 'clsx'
import { useConnection } from 'wagmi'
import { formatQuote, formatTokenAmount, formatUsd, formatUsdCompact, quoteWeiToUsd } from '@/lib/launch'
import Profile from '@/components/Profile'
import EmptyState from '@/components/ui/EmptyState'
import { TrophyIcon } from '@phosphor-icons/react'
import styles from './LaunchLeaderboard.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

const stampFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })

// Compact notation only earns its keep from four figures up; below that it rounds away the cents
// that are the whole number
const usdFigure = (value) =>
  value === null || value === undefined ? null : Math.abs(value) >= 1000 ? formatUsdCompact(value) : formatUsd(value)

/**
 * Launch Leaderboard
 * Who is winning on this token, ranked by profit rather than by size.
 *
 * Holders answers a different question and drops a wallet the instant it sells out, so the trader
 * who bought early and took the whole move is invisible there. Everything here is measured from
 * this token's own trades: proceeds already banked, plus what the open position is worth now,
 * against what the wallet put in. A bag that arrived by transfer was never a trade and is not
 * counted, which is why these figures can differ from the balances on the holders tab.
 */
const LaunchLeaderboard = ({ networkId, launchId, quote }) => {
  const quoteSymbol = quote?.symbol ?? 'ETH'
  const quoteDecimals = quote?.decimals ?? 18
  const { address } = useConnection()
  const me = address ? address.toLowerCase() : null

  const params = new URLSearchParams({ limit: '50' })
  if (me) params.set('me', me)

  const { data } = useSWR(`/api/v1/launches/${networkId}/${launchId}/leaderboard?${params}`, fetcher, {
    refreshInterval: 30_000,
  })

  const traders = data?.data ?? []
  const quoteUsd = data?.meta?.quote_usd ?? null
  // Ranked below the page but still theirs to see, so it rides along under a rule
  const you = data?.meta?.you ?? null

  // A value in the launch's quote asset, as money where a rate exists and as the coin where none does
  const asMoney = (wei) => {
    const value = BigInt(wei ?? 0)
    if (quoteUsd === null) return `${formatQuote(value, quoteDecimals)} ${quoteSymbol}`
    return usdFigure(quoteWeiToUsd(value, quoteUsd, quoteDecimals)) ?? '—'
  }

  if (!data) return <EmptyState icon={TrophyIcon}>Loading the leaderboard…</EmptyState>
  if (traders.length === 0) return <EmptyState icon={TrophyIcon}>Nobody has traded this yet.</EmptyState>

  const renderRow = (trader, { pinned = false } = {}) => {
    const rank = Number(trader.rank_position)
    const spentWei = BigInt(trader.native_in ?? 0)
    const heldTokens = BigInt(trader.held ?? 0)
    const pnlWei = BigInt(trader.pnl ?? 0)
    // Buying nothing leaves nothing to measure a return against — a wallet that was gifted the
    // token and sold it made money, but it has no percentage
    const roi = spentWei > 0n ? (Number(pnlWei) / Number(spentWei)) * 100 : null
    const isMe = me !== null && String(trader.wallet_address).toLowerCase() === me
    const span = trader.first_traded_at
      ? `First traded ${stampFormat.format(Number(trader.first_traded_at) * 1000)} · last ${stampFormat.format(
          Number(trader.last_traded_at) * 1000,
        )}`
      : undefined

    return (
      <tr
        key={`${pinned ? 'you' : 'row'}-${trader.wallet_address}`}
        className={clsx(
          isMe && styles['leaderboard__row--me'],
          pinned && styles['leaderboard__row--pinned'],
          rank <= 3 && !pinned && styles['leaderboard__row--podium'],
        )}
      >
        {/* Below 600px the app's global table styling hides the header and prints each cell's
            own data-label instead, so every one of these needs its column name */}
        <td
          data-label="Rank"
          className={clsx(styles.leaderboard__rank, rank <= 3 && styles[`leaderboard__rank--${rank}`])}
        >
          {rank}
        </td>

        <td data-label="Trader">
          {/* No networkId: every row on this page is the same chain, so the badge would only
              repeat what the header already says */}
          <span className={styles.leaderboard__who}>
            <Profile creator={trader.wallet_address} variant="compact" size={24} fingerprint={false} />
            {isMe && <em className={styles.leaderboard__you}>You</em>}
          </span>
        </td>

        <td data-label="Trades" className={styles.leaderboard__num} title={span}>
          {trader.trade_count}
        </td>

        <td data-label="Bought" className={styles.leaderboard__num}>
          {asMoney(trader.native_in)}
        </td>

        <td data-label="Sold" className={styles.leaderboard__num}>
          {BigInt(trader.native_out ?? 0) > 0n ? (
            asMoney(trader.native_out)
          ) : (
            <span className={styles.leaderboard__muted}>—</span>
          )}
        </td>

        <td data-label="Holding" className={styles.leaderboard__num}>
          {heldTokens > 0n ? (
            <>
              {asMoney(trader.held_value)}
              <small>{formatTokenAmount(heldTokens)}</small>
            </>
          ) : (
            <span className={styles.leaderboard__muted} title="Sold everything they bought here">
              Closed
            </span>
          )}
        </td>

        <td
          data-label="Profit"
          className={clsx(
            styles.leaderboard__pnl,
            pnlWei >= 0n ? styles['leaderboard__pnl--up'] : styles['leaderboard__pnl--down'],
          )}
        >
          <b>
            {pnlWei >= 0n ? '+' : '−'}
            {asMoney(pnlWei < 0n ? -pnlWei : pnlWei)}
          </b>
          {roi !== null && (
            <small>
              {roi >= 0 ? '+' : '−'}
              {Math.abs(roi).toFixed(1)}%
            </small>
          )}
        </td>
      </tr>
    )
  }

  return (
    <>
      {/* Six figure columns line up down the page and are read far faster than six sentences.
          It scrolls inside its own box so the page itself never does. */}
      <div className={styles.leaderboard__wrap}>
        <table className={styles.leaderboard}>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Trader</th>
              <th scope="col">Trades</th>
              <th scope="col">Bought</th>
              <th scope="col">Sold</th>
              <th scope="col">Holding</th>
              <th scope="col">Profit</th>
            </tr>
          </thead>
          <tbody>
            {traders.map((trader) => renderRow(trader))}
            {you && renderRow(you, { pinned: true })}
          </tbody>
        </table>
      </div>

      <p className={styles.leaderboard__note}>
        Ranked by profit taken plus the open position at the current price, measured only from trades on this token.
      </p>
    </>
  )
}

export default LaunchLeaderboard

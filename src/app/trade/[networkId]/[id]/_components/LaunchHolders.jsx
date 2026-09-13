'use client'

import useSWR from 'swr'
import clsx from 'clsx'
import { TOTAL_SUPPLY, WAD, formatQuote, formatTokenAmount, formatUsd, quoteWeiToUsd } from '@/lib/launch'
import Profile from '@/components/Profile'
import EmptyState from '@/components/ui/EmptyState'
import { UsersIcon } from '@phosphor-icons/react'
import styles from './LaunchHolders.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

/**
 * Launch Holders
 * Who actually owns the token, ranked by size.
 *
 * Position is priced off the pool right now. Profit is only shown for wallets that traded here,
 * because cost basis comes from indexed trades — a holder who was sent the token has a real
 * position and no basis, and inventing a zero for them would read as a 100% gain.
 */
const LaunchHolders = ({ networkId, launchId, quote }) => {
  const quoteSymbol = quote?.symbol ?? 'ETH'
  const quoteDecimals = quote?.decimals ?? 18
  const { data } = useSWR(`/api/v1/launches/${networkId}/${launchId}/holders?limit=50`, fetcher, {
    refreshInterval: 30_000,
  })

  const holders = data?.data ?? []
  const priceWei = BigInt(data?.meta?.price ?? 0)
  const quoteUsd = data?.meta?.quote_usd ?? null

  if (!data) return <EmptyState icon={UsersIcon}>Loading holders…</EmptyState>
  if (holders.length === 0) return <EmptyState icon={UsersIcon}>Nobody holds this yet.</EmptyState>

  return (
    <ul className={styles.holders}>
      <li className={styles.holders__head}>
        <span>Holder</span>
        <span>Position</span>
        <span>Profit</span>
        <span>% supply</span>
      </li>

      {holders.map((holder) => {
        const balance = BigInt(holder.balance ?? 0)
        const valueWei = (balance * priceWei) / WAD
        const spentWei = BigInt(holder.native_in ?? 0) - BigInt(holder.native_out ?? 0)
        // No trades here means no basis to measure against, not a profit of zero
        const hasBasis = Number(holder.trade_count) > 0 && spentWei > 0n
        const profitWei = hasBasis ? valueWei - spentWei : null
        const profitPct = hasBasis ? (Number(profitWei) / Number(spentWei)) * 100 : null
        const share = (Number(balance) / Number(TOTAL_SUPPLY)) * 100

        return (
          <li key={holder.wallet_address} className={styles.holders__row}>
            {/* No networkId: the whole list is one chain, so the badge would say it 50 times */}
            <span className={styles.holders__who}>
              <Profile creator={holder.wallet_address} variant="compact" size={24} fingerprint={false} />
            </span>

            <span className={styles.holders__position}>
              {quoteUsd
                ? formatUsd(quoteWeiToUsd(valueWei, quoteUsd, quoteDecimals))
                : `${formatQuote(valueWei, quoteDecimals)} ${quoteSymbol}`}
              <small>{formatTokenAmount(balance)}</small>
            </span>

            <span
              className={clsx(
                styles.holders__profit,
                profitWei !== null && (profitWei >= 0n ? styles['holders__profit--up'] : styles['holders__profit--down']),
              )}
            >
              {profitWei === null ? (
                <span className={styles.holders__muted} title="No trades on Hup to measure a cost basis against">
                  —
                </span>
              ) : (
                <>
                  {profitWei >= 0n ? '+' : '−'}
                  {quoteUsd
                    ? formatUsd(
                        Math.abs(quoteWeiToUsd(profitWei < 0n ? -profitWei : profitWei, quoteUsd, quoteDecimals) ?? 0),
                      )
                    : `${formatQuote(profitWei < 0n ? -profitWei : profitWei, quoteDecimals)} ${quoteSymbol}`}
                  {profitPct !== null && <small>{profitPct.toFixed(1)}%</small>}
                </>
              )}
            </span>

            <span className={styles.holders__share}>{share < 0.01 ? '<0.01' : share.toFixed(2)}%</span>
          </li>
        )
      })}
    </ul>
  )
}

export default LaunchHolders

'use client'

import clsx from 'clsx'
import { useTicker } from '@/hooks/useTicker'
import TokenIcon from '@/components/ui/TokenIcon'
import { chainBadgeFor, nativeLogoFor } from '@/config/chainBadges'
import { SLUG_CHAIN_IDS } from '@/config/cashtags'
import { tokenIconUrl } from '@/lib/tokenIcons'
import styles from './Ticker.module.scss'

// Sub-cent memecoins need far more precision than majors; anything under a cent gets the long
// tail so $BONK does not render as "$0.00"
const priceLabel = (price) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: price < 0.01 ? 10 : price < 1 ? 6 : 2,
  }).format(price)

const compactUsd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})

const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

/**
 * The cashtag hover card. Shape comes normalized from useTicker, so this renders the same
 * whether the quote came from DIA or from Hup's Solana endpoint.
 */
export default function Ticker({ blockchain, address, symbol }) {
  const { tickerData, isLoading, isError } = useTicker(blockchain, address, symbol)

  if (isLoading) return <div className={styles.tickerContainer}>Loading...</div>
  if (isError || !tickerData?.price) return null

  const { price, change24h, mcap, holders, logo, name, chainSlug, address: tokenAddress } = tickerData

  // DIA answers with a price and nothing else, so most cashtags arrive here with no artwork at
  // all — $LYX showed a blank coin. Same ladder the cards use: the upstream's own logo, then
  // the chain's mark for a native coin, then TrustWallet for a listed contract.
  const artwork =
    logo || nativeLogoFor(tickerData.symbol) || tokenIconUrl(SLUG_CHAIN_IDS[chainSlug], tokenAddress)
  // No movement figure is not the same as a flat one — leave the badge off rather than "0.00%"
  const hasChange = change24h !== null
  const isPositive = hasChange && change24h >= 0
  // Explicit booleans: a bare `mcap &&` renders the number 0 as text when a token has no figure
  const hasMcap = Boolean(mcap)
  const hasHolders = Boolean(holders)

  return (
    <div className={styles.tickerContainer}>
      <TokenIcon token={{ logo: artwork }} size="md" badge={chainBadgeFor(chainSlug)} />

      <div className={styles.info}>
        <span className={styles.symbol}>{tickerData.symbol}</span>
        {name && <span className={styles.ticker__name}>{name}</span>}
      </div>

      <div className={styles.values}>
        <span className={clsx(styles.price, hasChange && (isPositive ? styles.up : styles.down))}>
          {priceLabel(price)}
        </span>
        {hasChange && (
          <span className={clsx(styles.change, isPositive ? styles.up : styles.down)}>
            {isPositive ? '▲' : '▼'} {Math.abs(change24h).toFixed(2)}%
          </span>
        )}
      </div>

      {/* Market cap and holder count are the fastest read on whether a small-cap cashtag is a
          real market or a shell — the spoof tokens sharing these symbols have neither */}
      {(hasMcap || hasHolders) && (
        <div className={styles.ticker__meta}>
          {hasMcap && <span className={styles.ticker__metaItem}>{compactUsd.format(mcap)} mcap</span>}
          {hasHolders && <span className={styles.ticker__metaItem}>{compactNumber.format(holders)} holders</span>}
        </div>
      )}
    </div>
  )
}

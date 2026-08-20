'use client'

import clsx from 'clsx'
import { useCashtags } from '@/hooks/useCashtags'
import TokenIcon from '@/components/ui/TokenIcon'
import { chainBadgeFor, nativeLogoFor } from '@/config/chainBadges'
import { tokenIconUrl } from '@/lib/tokenIcons'
import { priceLabel, percentLabel, changeFor } from '@/lib/cashtagFormat'
import styles from './Ticker.module.scss'

const compactUsd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})

const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

/**
 * The cashtag hover card.
 *
 * Reads the exact row the card under the post reads — same registry, same endpoint, same
 * formatting — because the two used to be separate pipelines: this one quoted DIA against a
 * hand-kept address map while the card quoted DefiLlama, so hovering a cashtag showed one
 * price and the card two inches below it showed another. There is no second source left to
 * disagree with.
 */
export default function Ticker({ symbol }) {
  const { tokens, isLoading } = useCashtags(null, [symbol])
  const token = tokens[0]

  if (isLoading) return <div className={styles.tickerContainer}>Loading...</div>
  if (!token?.price) return null

  const { name, price, logo, chainSlug, chainId, address, mcap, holders } = token

  // The API supplies branding for tokens; a native coin borrows its chain's mark, and anything
  // left over falls through to TrustWallet and then to TokenIcon's own glyph
  const artwork = logo || nativeLogoFor(token.symbol) || (chainId && address ? tokenIconUrl(chainId, address) : null)

  // The move, and the window it actually covers — the card prints the same pair
  const { change, label } = changeFor(token)
  // No movement figure is not the same as a flat one — leave the badge off rather than "0.00%"
  const hasChange = change !== null
  const isUp = hasChange && change >= 0
  // Explicit booleans: a bare `mcap &&` renders the number 0 as text when a token has no figure
  const hasMcap = Boolean(mcap)
  const hasHolders = Boolean(holders)

  return (
    <div className={styles.tickerContainer}>
      <TokenIcon token={{ logo: artwork }} size="md" badge={chainBadgeFor(chainSlug)} />

      <div className={styles.info}>
        <span className={styles.symbol}>{token.symbol}</span>
        {name && <span className={styles.ticker__name}>{name}</span>}
      </div>

      <div className={styles.values}>
        <span className={clsx(styles.price, hasChange && (isUp ? styles.up : styles.down))}>{priceLabel(price)}</span>
        {hasChange && (
          <span className={clsx(styles.change, isUp ? styles.up : styles.down)}>
            {isUp ? '▲' : '▼'} {percentLabel(change)}
            <span className={styles.ticker__period}>{label}</span>
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

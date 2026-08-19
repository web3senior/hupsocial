'use client'

import clsx from 'clsx'
import { chainBadgeFor, nativeLogoFor } from '@/config/chainBadges'
import TokenIcon from '@/components/ui/TokenIcon'
import PriceSparkline from '@/components/ui/PriceSparkline'
import { tokenIconUrl } from '@/lib/tokenIcons'
import { rangeLabelFor } from '@/lib/priceHistory'
import styles from './CashtagCard.module.scss'

// Sub-cent tokens need the long tail or $BONK renders as "$0.00"
const priceLabel = (price) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: price < 0.01 ? 8 : price < 1 ? 6 : 2,
  }).format(price)

// A launch-price move can run to six figures of percent — ANSEM's is +125,000% — so anything
// past four digits switches to compact notation rather than breaking the row
const percentLabel = (percent) => {
  const magnitude = Math.abs(percent)
  const formatted =
    magnitude >= 10_000
      ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(magnitude)
      : magnitude.toFixed(2)
  return `${formatted}%`
}

// The card carries direction in its arrow, so percentLabel drops the sign. A hover string has
// no arrow beside it, so it has to say which way the period went.
const signedPercentLabel = (percent) => `${percent >= 0 ? '+' : '−'}${percentLabel(percent)}`

/**
 * Cashtag Card — compact
 * The row a post renders per cashtag: identity, live price, the 24h move, and a week of price
 * as a sparkline. Nothing here is stored on the post; the symbol is, and everything else
 * resolves at render, so a card never shows a number that was true last Tuesday.
 *
 * Direction is carried by the arrow and the signed figure as well as the colour — see the note
 * in PriceSparkline about why that pairing is not optional.
 */
const CashtagCard = ({ token, onRemove, wide = false }) => {
  if (!token) return null

  const { symbol, name, price, change24h, logo, chainSlug, chainId, address, history } = token

  // Named by what the line actually spans, not by what was requested — see rangeLabelFor
  const rangeLabel = history ? rangeLabelFor(history) : null
  // One window per card: the percentage describes exactly the span the line draws. Printing a
  // 24h figure beside a week-long chart meant ANSEM could show a red number over a green line —
  // down on the day, up on the week — and neither reading was wrong, which is what made it
  // impossible to trust. The series' own change wins whenever there is a series.
  const periodChange = history?.changePct
  const change = typeof periodChange === 'number' && Number.isFinite(periodChange) ? periodChange : change24h
  const hasChange = typeof change === 'number' && Number.isFinite(change)
  const isUp = hasChange ? change >= 0 : true
  const direction = isUp ? 'up' : 'down'
  const chartUp = isUp

  // The API supplies branding for tokens; a native coin borrows its chain's mark, and anything
  // left over falls through to TrustWallet and then to TokenIcon's own glyph
  const artwork = logo || nativeLogoFor(symbol) || (chainId && address ? tokenIconUrl(chainId, address) : null)

  return (
    <article className={clsx(styles.cashtagCard, wide && styles['cashtagCard--wide'])}>
      <TokenIcon token={{ logo: artwork }} size="lg" badge={chainBadgeFor(chainSlug)} />

      <div className={styles.cashtagCard__identity}>
        <span className={styles.cashtagCard__name}>{name}</span>
        <span className={styles.cashtagCard__meta}>
          <span className={styles.cashtagCard__symbol}>{symbol}</span>
          <span className={styles.cashtagCard__price}>{priceLabel(price)}</span>
          {hasChange && (
            <span className={clsx(styles.cashtagCard__change, styles[`cashtagCard__change--${direction}`])}>
              {isUp ? '↑' : '↓'} {percentLabel(change)}
              <span className={styles.cashtagCard__period}>{rangeLabel ?? '24h'}</span>
            </span>
          )}
        </span>
      </div>

      {/* A token too thin to chart still deserves its quote — the row just loses the trend */}
      {history?.points?.length > 1 && (
        <span className={styles.cashtagCard__chartWrap}>
          <PriceSparkline
            points={history.points}
            direction={direction}
            height={40}
            title={`${symbol} · past ${rangeLabel} · ${signedPercentLabel(history.changePct ?? 0)} over the period`}
            label={`${symbol} price over the past ${rangeLabel}, ${chartUp ? 'up' : 'down'} ${percentLabel(periodChange ?? 0)}`}
          />
        </span>
      )}

      {onRemove && (
        <button
          type="button"
          className={styles.cashtagCard__remove}
          onClick={onRemove}
          aria-label={`Remove the ${symbol} card`}
        >
          ✕
        </button>
      )}
    </article>
  )
}

export default CashtagCard

'use client'

import clsx from 'clsx'
import { chainBadgeFor, nativeLogoFor } from '@/config/chainBadges'
import TokenIcon from '@/components/ui/TokenIcon'
import PriceSparkline from '@/components/ui/PriceSparkline'
import { tokenIconUrl } from '@/lib/tokenIcons'
import { priceLabel, percentLabel, signedPercentLabel, changeFor } from '@/lib/cashtagFormat'
import styles from './CashtagCard.module.scss'

/**
 * Cashtag Card — compact
 * The row a post renders per cashtag: identity, live price, the move, and the same span as a
 * sparkline. Nothing here is stored on the post; the symbol is, and everything else resolves
 * at render, so a card never shows a number that was true last Tuesday.
 *
 * The figures come from lib/cashtagFormat, which the hover card also uses — the two surfaces
 * quote one token and must never print it two ways.
 *
 * Direction is carried by the arrow and the signed figure as well as the colour — see the note
 * in PriceSparkline about why that pairing is not optional.
 */
const CashtagCard = ({ token, onRemove, wide = false }) => {
  if (!token) return null

  const { symbol, name, price, logo, chainSlug, chainId, address, history } = token

  // One window per card: the percentage describes exactly the span the line draws, and the
  // label names that span rather than the one that was asked for — see changeFor
  const { change, label } = changeFor(token)
  const hasChange = change !== null
  const isUp = hasChange ? change >= 0 : true
  const direction = isUp ? 'up' : 'down'

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
              <span className={styles.cashtagCard__period}>{label}</span>
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
            title={`${symbol} · past ${label} · ${signedPercentLabel(history.changePct ?? 0)} over the period`}
            label={`${symbol} price over the past ${label}, ${isUp ? 'up' : 'down'} ${percentLabel(history.changePct ?? 0)}`}
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

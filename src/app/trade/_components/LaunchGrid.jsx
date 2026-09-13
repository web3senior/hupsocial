'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { appChains } from '@/config/contracts'
import { chainIconFor, networkColorStyle } from '@/lib/networkColors'
import { toRelativeTimestamp } from '@/lib/dateHelper'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { launchHref } from '@/lib/tokenRef'
import { formatChangePct, formatUsdFigure } from '@/lib/launch'
import useQuickBuy from '@/hooks/useQuickBuy'
import { ArrowsDownUpIcon, CoinIcon, LightningIcon } from '@phosphor-icons/react'
import styles from './LaunchGrid.module.scss'

/**
 * One card. Its own component only because of the ⚡ — a real trade needs the wallet, the pool key
 * and its own pending state, none of which can be hoisted into a parent rendering fifty of them.
 */
const LaunchGridCard = ({ token }) => {
  const chainId = Number(token.network_id)
  const isHup = token.source === 'hup'

  const href = isHup
    ? launchHref(token.network_id, token.address)
    : `/swap?chain=${token.network_id}&token=${token.address}`

  // Inert for anything Hup did not launch: only its own pools have a key we can rebuild
  const { buy, isBusy, canBuy, blocked, spendUsd } = useQuickBuy(isHup ? token : null, chainId)

  const chainInfo = useMemo(() => appChains.find((chain) => chain.id === chainId), [chainId])
  const chainIcon = chainIconFor(chainInfo)
  const imageUrl = token.logo ? resolveStorageImageUrl(token.logo) : null
  const dayChange = token.change_24h

  return (
    // Colours come from the token's own chain, never the connected wallet's
    <li className={styles.grid__card} style={networkColorStyle(chainInfo)}>
      <Link href={href} className={styles.grid__link} title={[token.name, chainInfo?.name, token.venue].filter(Boolean).join(' · ')}>
        <span className={styles.grid__media}>
          <span className={styles.grid__fallback} aria-hidden="true">
            <CoinIcon size={30} />
          </span>
          {imageUrl && (
            // A CID that no gateway answers leaves the fallback tile showing rather than the
            // browser's own broken-image mark
            <img
              className={styles.grid__art}
              src={imageUrl}
              alt=""
              loading="lazy"
              onError={(event) => {
                event.currentTarget.hidden = true
              }}
            />
          )}
        </span>

        <span className={styles.grid__body}>
          <span className={styles.grid__nameRow}>
            <strong>{token.name}</strong>
            {chainIcon && <img className={styles.grid__chain} src={chainIcon} alt="" loading="lazy" />}
          </span>
          <span className={styles.grid__ticker}>${token.symbol}</span>

          <span className={styles.grid__figures}>
            <b>
              {token.market_cap_usd ? formatUsdFigure(token.market_cap_usd) : '—'}
              <small>MC</small>
            </b>
            {dayChange !== null && dayChange !== undefined && (
              <em
                className={clsx(
                  dayChange > 0 && styles['grid__change--up'],
                  dayChange < 0 && styles['grid__change--down'],
                )}
              >
                {formatChangePct(dayChange)}
              </em>
            )}
          </span>
        </span>
      </Link>

      {/* Rides over the artwork, outside the card's link */}
      <span className={styles.grid__overlay}>
        <span className={styles.grid__age}>
          {token.created_at ? toRelativeTimestamp(Number(token.created_at)) : (token.venue ?? chainInfo?.name)}
        </span>
        {isHup ? (
          <button
            type="button"
            className={styles.grid__buy}
            disabled={isBusy || !canBuy}
            title={blocked ?? `Buy $${spendUsd} of ${token.symbol}`}
            aria-label={blocked ?? `Buy $${spendUsd} of ${token.symbol}`}
            onClick={buy}
          >
            <LightningIcon size={14} weight="fill" />
          </button>
        ) : (
          <Link
            href={href}
            className={clsx(styles.grid__buy, styles['grid__buy--swap'])}
            title={`Swap ${token.symbol}`}
            aria-label={`Swap ${token.symbol}`}
          >
            <ArrowsDownUpIcon size={13} />
          </Link>
        )}
      </span>
    </li>
  )
}

/**
 * Launch Grid
 * The explorer's browsing view. Artwork leads, because a memecoin is recognised before it is
 * evaluated — the figures underneath are what you check once something has caught your eye.
 */
const LaunchGrid = ({ tokens }) => (
  <ul className={clsx(styles.grid, 'animate fade')}>
    {tokens.map((token) => (
      <LaunchGridCard key={token.key} token={token} />
    ))}
  </ul>
)

export default LaunchGrid

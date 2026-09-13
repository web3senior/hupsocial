'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { appChains } from '@/config/contracts'
import { chainIconFor, networkColorStyle } from '@/lib/networkColors'
import { toRelativeTimestamp } from '@/lib/dateHelper'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { launchHref } from '@/lib/tokenRef'
import { formatChangePct, formatCount, formatUsd, formatUsdFigure } from '@/lib/launch'
import useQuickBuy from '@/hooks/useQuickBuy'
import { ArrowsDownUpIcon, CoinIcon, LightningIcon } from '@phosphor-icons/react'
import styles from './LaunchTable.module.scss'

const WINDOWS = ['change_1h', 'change_6h', 'change_24h']

/**
 * Launch Table Row
 * One token as a line in the explorer.
 *
 * Rows arrive from three different places — Hup's own index, an aggregator, an issuer's registry —
 * and the only one that can be traded in a single press is Hup's own, because that is the only one
 * whose pool key we can rebuild without probing. Everything else sends the reader to the swap page
 * with the pair already chosen, which is one more click and no guesswork.
 *
 * A component of its own rather than markup inside the table, because that ⚡ is a real trade: it
 * needs the wallet, the pool key and the write's own pending state, none of which can be hoisted
 * into a parent rendering fifty of them.
 */
const LaunchTableRow = ({ token, rank }) => {
  const router = useRouter()
  const chainId = Number(token.network_id)
  const isHup = token.source === 'hup'

  const href = isHup
    ? launchHref(token.network_id, token.address)
    : `/swap?chain=${token.network_id}&token=${token.address}`

  // Only a Hup launch has a pool key to trade against; for anything else this stays inert and
  // the row falls back to the swap link
  const { buy, isBusy, canBuy, blocked, spendUsd } = useQuickBuy(isHup ? token : null, chainId)

  const chainInfo = useMemo(() => appChains.find((chain) => chain.id === chainId), [chainId])
  const chainIcon = chainIconFor(chainInfo)
  const imageUrl = token.logo ? resolveStorageImageUrl(token.logo) : null

  // A dollar figure of zero here means "not reported", not "worth nothing" — an aggregator leaves
  // market cap at zero for anything it has not formally listed, and printing $0.00 for a token
  // trading at two dollars is worse than admitting the number is missing
  const figure = (value) => (!value ? '—' : formatUsdFigure(value))

  return (
    <tr
      className={styles.table__row}
      style={networkColorStyle(chainInfo)}
      onClick={() => router.push(href)}
      title={[chainInfo?.name, token.venue].filter(Boolean).join(' · ')}
    >
      <td className={styles.table__rank}>{rank}</td>

      <td className={styles.table__coin}>
        {/* A real link inside the row the whole of which is clickable: middle-click, keyboard and
            "open in new tab" all have to keep working */}
        <Link href={href} className={styles.table__identity} onClick={(event) => event.stopPropagation()}>
          <span className={styles.table__art}>
            <span className={styles.table__artFallback} aria-hidden="true">
              <CoinIcon size={18} />
            </span>
            {imageUrl && (
              <img
                src={imageUrl}
                alt=""
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.hidden = true
                }}
              />
            )}
            {chainIcon && <img className={styles.table__chain} src={chainIcon} alt="" loading="lazy" />}
          </span>

          <span className={styles.table__names}>
            <strong>{token.name}</strong>
            <em>${token.symbol}</em>
          </span>
        </Link>
      </td>

      <td className={styles.table__figure}>
        <b>{token.price_usd === null || token.price_usd === undefined ? '—' : formatUsd(token.price_usd)}</b>
      </td>
      <td className={styles.table__figure}>{figure(token.market_cap_usd)}</td>
      <td className={styles.table__figure}>{figure(token.liquidity_usd)}</td>
      <td className={styles.table__figure}>
        {token.created_at ? toRelativeTimestamp(Number(token.created_at)) : '—'}
      </td>
      <td className={styles.table__figure}>{token.txns_24h ? formatCount(token.txns_24h) : '—'}</td>
      <td className={styles.table__figure}>{figure(token.volume_24h_usd)}</td>
      <td className={styles.table__figure}>{token.traders_24h ? formatCount(token.traders_24h) : '—'}</td>

      {WINDOWS.map((field) => {
        const value = token[field]
        return (
          <td
            key={field}
            className={clsx(
              styles.table__change,
              value !== null && value !== undefined && value > 0 && styles['table__change--up'],
              value !== null && value !== undefined && value < 0 && styles['table__change--down'],
            )}
          >
            {value === null || value === undefined ? '—' : formatChangePct(value)}
          </td>
        )
      })}

      <td className={styles.table__action}>
        {isHup ? (
          <button
            type="button"
            className={styles.table__buy}
            disabled={isBusy || !canBuy}
            title={blocked ?? `Buy $${spendUsd} of ${token.symbol}`}
            aria-label={blocked ?? `Buy $${spendUsd} of ${token.symbol}`}
            onClick={(event) => {
              event.stopPropagation()
              buy()
            }}
          >
            <LightningIcon size={15} weight="fill" />
          </button>
        ) : (
          <Link
            href={href}
            className={styles.table__swap}
            title={`Swap ${token.symbol}`}
            aria-label={`Swap ${token.symbol}`}
            onClick={(event) => event.stopPropagation()}
          >
            <ArrowsDownUpIcon size={15} />
          </Link>
        )}
      </td>
    </tr>
  )
}

export default LaunchTableRow

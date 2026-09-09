'use client'

/**
 * @file components/ProfilePortfolio.jsx
 * @description The holdings strip inside a profile card: the native balance on the post's own
 * chain, the wallet's dollar total across every supported chain, and how many positions that is
 * spread over.
 *
 * Every figure is public onchain data — the same holdings the profile's Assets tab lists to any
 * visitor — read through one cached route rather than by this component, which is what keeps a
 * feed of hovered avatars from costing nine chains of RPC apiece.
 *
 * Nothing renders until there is something true to say: no wallet, no priced holdings and no
 * native balance all end in null. A portfolio printed as "$0.00" is a claim about someone's
 * worth that nobody made.
 */

import clsx from 'clsx'
import { formatUnits } from 'viem'
import { appChains } from '@/config/contracts'
import { isSolanaNetworkId, solanaChainFor } from '@/config/solana'
import { toRelativeTime } from '@/lib/dateHelper'
import { chainIconFor } from '@/lib/networkColors'
import { formatUsd } from '@/lib/usdAmount'
import useWalletPortfolio from '@/hooks/useWalletPortfolio'
import styles from './ProfilePortfolio.module.scss'

const countFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

// DefiLlama reports 24h movement as a signed percentage (2.31 meaning 2.31%), while Intl's
// percent style expects a ratio
const percentFormatter = new Intl.NumberFormat(undefined, {
  style: 'percent',
  signDisplay: 'exceptZero',
  maximumFractionDigits: 1,
})

// Two tiles share a 260px card, which leaves each figure about 95px of a semibold 14px line.
// Precision has to fall away as the magnitude climbs or the number is cut off mid-digit, so the
// tiles round and the title carries the amount whole.
const balanceFormatters = {
  // Sub-1 balances keep significant digits — fraction rounding would collapse dust to '0'
  small: new Intl.NumberFormat(undefined, { maximumSignificantDigits: 3 }),
  plain: new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }),
  compact: new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }),
  exact: new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 }),
}

const usdExactFormatter = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' })
const usdWholeFormatter = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

/** A native balance at tile width, alongside the same amount unrounded for the title. */
const formatBalance = (balance, decimals) => {
  if (balance === null || balance === undefined || decimals === null || decimals === undefined) return null

  try {
    const value = Number(formatUnits(BigInt(balance), Number(decimals)))
    if (!Number.isFinite(value)) return null
    const formatter = value > 0 && value < 1 ? balanceFormatters.small : value < 1000 ? balanceFormatters.plain : balanceFormatters.compact
    return { display: formatter.format(value), exact: balanceFormatters.exact.format(value) }
  } catch {
    return null
  }
}

// Cents are worth printing on a $12.40 wallet and noise on an $8,288 one, where they were also
// what pushed the 24h move off the end of the tile. Past six figures formatUsd is already compact.
const formatTotal = (value) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return null

  const magnitude = Math.abs(value)
  return magnitude >= 1000 && magnitude < 100000 ? usdWholeFormatter.format(value) : formatUsd(value)
}

// Only worth a tooltip where the tile actually rounded — below a thousand the two agree
const formatTotalTitle = (value) => (value !== null && Math.abs(value) >= 1000 ? usdExactFormatter.format(value) : undefined)

const chainFor = (chainId) =>
  isSolanaNetworkId(chainId) ? solanaChainFor(chainId) : appChains.find((chain) => chain.id === Number(chainId)) ?? null

export default function ProfilePortfolio({ address, networkId }) {
  const { portfolio, isLoading } = useWalletPortfolio(address, networkId)

  if (isLoading) {
    return (
      <div className={styles.portfolio} aria-hidden="true">
        <div className={styles.portfolio__tiles}>
          <div className={clsx('shimmer', styles.portfolio__shimmer)} />
          <div className={clsx('shimmer', styles.portfolio__shimmer)} />
        </div>
      </div>
    )
  }

  const native = portfolio?.native
  const totalUsd = typeof portfolio?.totalUsd === 'number' ? portfolio.totalUsd : null
  const total = formatTotal(totalUsd)
  // A wallet the route could not read, or one holding nothing, gets no strip at all
  if (!native && !total) return null

  const chain = native ? chainFor(native.chainId) : null
  const chainIcon = chainIconFor(chain)
  const amount = native ? formatBalance(native.balance, native.decimals) : null
  const amountTitle = amount ? [`${amount.exact} ${native.symbol || ''}`.trim(), chain?.name].filter(Boolean).join(' · ') : undefined
  const change = typeof portfolio.change24h === 'number' ? portfolio.change24h : null
  const tokenCount = portfolio.tokenCount ?? 0

  return (
    <div className={styles.portfolio}>
      <div className={styles.portfolio__tiles}>
        {native && amount && (
          <div className={styles.portfolio__tile}>
            <span className={styles.portfolio__label}>
              {chainIcon && <img className={styles.portfolio__chain} src={chainIcon} alt="" width={12} height={12} />}
              {native.symbol || chain?.name || 'Balance'}
            </span>
            <span className={styles.portfolio__value} title={amountTitle}>
              {amount.display}
            </span>
          </div>
        )}

        {total && (
          <div className={styles.portfolio__tile}>
            <span className={styles.portfolio__label}>Portfolio</span>
            <span className={styles.portfolio__value}>
              <span className={styles.portfolio__usd} title={formatTotalTitle(totalUsd)}>
                {total}
              </span>
              {/* Only the move is coloured. Painting the total itself would flip a whole portfolio
                  red over a tenth of a percent, which says far more than the day did */}
              {change !== null && (
                <small className={clsx(styles.portfolio__change, styles[change < 0 ? 'portfolio__change--down' : 'portfolio__change--up'])}>
                  {percentFormatter.format(change / 100)}
                </small>
              )}
            </span>
          </div>
        )}
      </div>

      <p className={styles.portfolio__meta}>
        {tokenCount > 0 && (
          <span>
            Holding <strong>{countFormatter.format(tokenCount)}</strong> {tokenCount === 1 ? 'token' : 'tokens'}
          </span>
        )}
        {tokenCount > 0 && portfolio.updatedAt && <span aria-hidden="true"> · </span>}
        {portfolio.updatedAt && <span>Updated {toRelativeTime(portfolio.updatedAt)} ago</span>}
      </p>
    </div>
  )
}

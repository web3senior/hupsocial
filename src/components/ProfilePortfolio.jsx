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
import { appChains } from '@/config/contracts'
import { isSolanaNetworkId, solanaChainFor } from '@/config/solana'
import { formatTokenDisplay } from '@/app/communities/tokenUnits'
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
  const total = formatUsd(portfolio?.totalUsd)
  // A wallet the route could not read, or one holding nothing, gets no strip at all
  if (!native && !total) return null

  const chain = native ? chainFor(native.chainId) : null
  const chainIcon = chainIconFor(chain)
  const amount = native ? formatTokenDisplay(native.balance, native.decimals) : null
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
            <span className={styles.portfolio__value} title={chain?.name ?? undefined}>
              {amount}
            </span>
          </div>
        )}

        {total && (
          <div className={styles.portfolio__tile}>
            <span className={styles.portfolio__label}>Portfolio</span>
            <span className={styles.portfolio__value}>
              <span className={styles.portfolio__usd}>{total}</span>
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

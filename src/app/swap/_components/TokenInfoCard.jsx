'use client'

import { useEffect, useState } from 'react'
import { ArrowSquareOutIcon, CheckIcon, CopyIcon } from '@phosphor-icons/react'
import useTokenInfo from '@/hooks/useTokenInfo'
import TokenIcon from '@/components/ui/TokenIcon'
import { toast } from '@/components/NextToast'
import styles from './TokenInfoCard.module.scss'

const shortAddress = (value) => `${value.slice(0, 6)}…${value.slice(-4)}`

// Compact dollars for the stat tiles — $12.4M, not eight digits
const compactUsd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})
// Spot price keeps significant digits so a memecoin's $0.0000042 doesn't collapse to $0.00
const wholeUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const tinyUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumSignificantDigits: 3 })
const priceLabel = (value) => (value >= 1 ? wholeUsd.format(value) : tinyUsd.format(value))

/**
 * Token Info Card
 * Who the selected token is and what the market says about it: GeckoTerminal's listing —
 * price, 24h volume, market cap (FDV when uncapped), liquidity — under the token's real
 * name, with the contract address copyable and linked to the explorer. Identity renders
 * even when GeckoTerminal has never heard of the token: for a fresh Hup launch, that
 * copyable contract IS the info.
 */
const TokenInfoCard = ({ chainId, address, symbol, logo, explorerUrl }) => {
  const { info } = useTokenInfo(chainId, address)
  const [copied, setCopied] = useState(false)

  // The copied tick must not survive a switch to another token
  useEffect(() => setCopied(false), [address])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast('Could not copy the address', 'error')
    }
  }

  // Zeros hide alongside nulls: GeckoTerminal reports 0 where it doesn't track a figure
  // (USDC's reserve, for one), and a "$0" tile is misinformation, not information
  const stats = []
  if (info) {
    if (info.priceUsd) stats.push({ label: 'Price', value: priceLabel(info.priceUsd) })
    if (info.volume24hUsd) stats.push({ label: '24h volume', value: compactUsd.format(info.volume24hUsd) })
    // Market cap when GeckoTerminal has one, otherwise fully-diluted — never both
    if (info.marketCapUsd) stats.push({ label: 'Market cap', value: compactUsd.format(info.marketCapUsd) })
    else if (info.fdvUsd) stats.push({ label: 'FDV', value: compactUsd.format(info.fdvUsd) })
    if (info.liquidityUsd) stats.push({ label: 'Liquidity', value: compactUsd.format(info.liquidityUsd) })
  }

  const explorerBase = explorerUrl?.replace(/\/$/, '')

  return (
    <section className={styles.tokenInfo}>
      <header className={styles.tokenInfo__header}>
        <TokenIcon token={{ address, logo: logo ?? info?.logo ?? null }} chainId={chainId} />
        <span className={styles.tokenInfo__identity}>
          <strong>{info?.name ?? symbol ?? shortAddress(address)}</strong>
          <small>{info?.symbol ?? symbol ?? 'Token'}</small>
        </span>
        <span className={styles.tokenInfo__contract}>
          <button
            type="button"
            className={styles.tokenInfo__copy}
            onClick={handleCopy}
            title={`Copy ${address}`}
            aria-label={`Copy the contract address ${address}`}
          >
            <code>{shortAddress(address)}</code>
            {copied ? <CheckIcon size={12} weight="bold" /> : <CopyIcon size={12} />}
          </button>
          {explorerBase && (
            <a
              href={`${explorerBase}/address/${address}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.tokenInfo__link}
              title="Open the token contract in the explorer"
            >
              <ArrowSquareOutIcon size={12} />
            </a>
          )}
        </span>
      </header>

      {stats.length > 0 && (
        <dl className={styles.tokenInfo__stats}>
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

export default TokenInfoCard

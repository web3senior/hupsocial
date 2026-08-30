'use client'

import { CopyIcon } from '@phosphor-icons/react'
import { toast } from '@/components/NextToast'
import { appChains } from '@/config/contracts'
import { tokenIconUrl } from '@/lib/tokenIcons'
import useTokenIcon from '@/hooks/useTokenIcon'
import { formatTokenAmount } from './formatTokenAmount'
import styles from './RevenueHero.module.scss'

const compactFormatter = new Intl.NumberFormat(undefined, { notation: 'compact' })
const usdFormatter = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' })

const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000'

// The wagmi config stamps iconUrl onto these shared chain objects at client load.
function chainIconUrl(networkId) {
  return appChains.find((chain) => chain.id === networkId)?.iconUrl || null
}

function shortAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function copyTokenAddress(address) {
  navigator.clipboard
    .writeText(address)
    .then(() => toast('Token address copied', 'success'))
    .catch(() => toast('Copy failed', 'error'))
}

function TokenRow({ total }) {
  const isNative = total.token === NATIVE_TOKEN
  const chainIcon = chainIconUrl(total.network_id)
  // LSP7 tokens carry their own branding onchain (LSP4Metadata icon)
  const lsp7Icon = useTokenIcon({
    chainId: total.network_id,
    token: total.token,
    enabled: total.is_lsp7 && !isNative,
  })

  // Native rows wear the chain icon; LSP7s their onchain icon; plain ERC20s try
  // TrustWallet. Initials always render underneath as the fallback.
  const iconSrc = isNative ? chainIcon : lsp7Icon || tokenIconUrl(total.network_id, total.token)

  return (
    <li className={styles.hero__token}>
      <span className={styles.hero__avatar} aria-hidden="true">
        <span className={styles.hero__avatarInitials}>{total.symbol.slice(0, 2)}</span>
        {iconSrc && (
          <img
            key={iconSrc}
            className={styles.hero__avatarImg}
            src={iconSrc}
            alt=""
            onError={(event) => {
              event.currentTarget.style.display = 'none'
            }}
          />
        )}
        {/* Native rows already wear the chain icon as their avatar */}
        {!isNative && chainIcon && <img className={styles.hero__avatarChain} src={chainIcon} alt="" />}
      </span>

      <span className={styles.hero__tokenNames}>
        <span className={styles.hero__symbol}>{total.symbol}</span>
        <span className={styles.hero__network}>
          {total.network_name || `Chain ${total.network_id}`}
          {!isNative && (
            <button
              type="button"
              className={styles.hero__address}
              title={`${total.token} — click to copy`}
              onClick={() => copyTokenAddress(total.token)}
            >
              {shortAddress(total.token)}
              <CopyIcon size={11} />
            </button>
          )}
        </span>
      </span>

      <span className={styles.hero__tokenValues}>
        <span className={styles.hero__amount}>
          {formatTokenAmount(total.total, total.decimals)} {total.symbol}
        </span>
        <span className={styles.hero__tokenMeta}>
          {total.usd_value !== null
            ? usdFormatter.format(total.usd_value)
            : `${compactFormatter.format(total.payments)} ${total.payments === 1 ? 'payment' : 'payments'}`}
        </span>
      </span>
    </li>
  )
}

export default function RevenueHero({ totals, supporterCount, paymentsCount }) {
  const pricedTotals = totals.filter((total) => total.usd_value !== null)
  const usdTotal = pricedTotals.reduce((sum, total) => sum + total.usd_value, 0)

  return (
    <section className={styles.hero} aria-label="Money summary">
      <div className={styles.hero__headline}>
        <span className={styles.hero__eyebrow}>Total earned</span>
        {pricedTotals.length > 0 && <span className={styles.hero__usd}>{usdFormatter.format(usdTotal)}</span>}
        <span className={styles.hero__meta}>
          {compactFormatter.format(paymentsCount)} {paymentsCount === 1 ? 'payment' : 'payments'} ·{' '}
          {compactFormatter.format(supporterCount)} {supporterCount === 1 ? 'supporter' : 'supporters'}
        </span>
      </div>

      <ul className={styles.hero__tokens}>
        {totals.map((total) => (
          <TokenRow key={`${total.network_id}-${total.token}`} total={total} />
        ))}
      </ul>
    </section>
  )
}

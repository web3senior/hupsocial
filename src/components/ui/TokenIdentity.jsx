'use client'

import { useState } from 'react'
import clsx from 'clsx'
import { ArrowSquareOutIcon, CheckIcon, CopyIcon } from '@phosphor-icons/react'
import useTokenIcon from '@/hooks/useTokenIcon'
import TokenIcon from '@/components/ui/TokenIcon'
import { toast } from '@/components/NextToast'
import styles from './TokenIdentity.module.scss'

const shortAddress = (value) => `${value.slice(0, 6)}…${value.slice(-4)}`

/**
 * Token Identity
 * Who a token actually is, in one row: artwork, ticker, what standard it speaks, and the
 * contract address behind it — copyable and linked to the explorer.
 *
 * The address is the point. A ticker is not an identity: anyone can deploy a token called
 * USDC, and a deal or an offer is agreed against a contract, not a name. So the address is
 * shown rather than tucked into a tooltip, wherever someone is about to commit funds against
 * one. Native coins render as artwork and ticker alone — there is no contract to verify.
 *
 * Icon resolution layers, because no single source covers every standard: a token's own
 * LSP4Metadata icon (LSP7, read onchain) sits over TrustWallet's CDN (curated ERC20s), which
 * sits over a coin glyph that is always painted underneath. See TokenIcon.
 *
 * @param {Object} props
 * @param {number} props.chainId Chain the token lives on.
 * @param {string|null} props.address Contract address, or null for the chain's native coin.
 * @param {string} [props.symbol] Ticker. Falls back to the shortened address when unresolved.
 * @param {boolean} [props.isLsp7=false] Read the icon from LSP4 metadata instead of the CDN.
 * @param {number} [props.decimals] Shown beside the standard when known.
 * @param {string} [props.standard] 'ERC20' | 'LSP7' | omitted to hide the standard line.
 * @param {string} [props.explorerUrl] Block explorer base, trailing slash optional.
 * @param {'sm'|'md'|'lg'} [props.size='md'] Icon size.
 * @param {string} [props.className] Applied to the row wrapper.
 */
export default function TokenIdentity({
  chainId,
  address,
  symbol,
  isLsp7 = false,
  decimals,
  standard,
  explorerUrl,
  size = 'md',
  className,
}) {
  const [copied, setCopied] = useState(false)

  // Only LSP7 carries onchain artwork; for everything else this stays null and TokenIcon
  // falls through to the CDN on its own
  const lsp4Icon = useTokenIcon({ chainId, token: address, enabled: Boolean(isLsp7 && address) })

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast('Could not copy the address', 'error')
    }
  }

  const base = explorerUrl?.replace(/\/$/, '')
  const details = [standard, decimals !== undefined && decimals !== null ? `${decimals} decimals` : null].filter(Boolean).join(' · ')

  return (
    <span className={clsx(styles.tokenIdentity, className)}>
      <TokenIcon token={{ logo: lsp4Icon, address }} chainId={chainId} size={size} />

      <span className={styles.tokenIdentity__body}>
        <span className={styles.tokenIdentity__line}>
          <strong className={styles.tokenIdentity__symbol}>{symbol || (address ? shortAddress(address) : '')}</strong>
          {details && <span className={styles.tokenIdentity__details}>{details}</span>}
        </span>

        {/* Native has no contract, so nothing to copy or open */}
        {address && (
          <span className={styles.tokenIdentity__line}>
            <button
              type="button"
              className={styles.tokenIdentity__address}
              onClick={handleCopy}
              title={`Copy ${address}`}
              aria-label={`Copy the contract address ${address}`}
            >
              <code>{shortAddress(address)}</code>
              {copied ? <CheckIcon size={11} weight="bold" /> : <CopyIcon size={11} />}
            </button>

            {base && (
              <a
                href={`${base}/address/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.tokenIdentity__link}
                title="Open the token contract in the explorer"
              >
                <ArrowSquareOutIcon size={11} />
              </a>
            )}
          </span>
        )}
      </span>
    </span>
  )
}
